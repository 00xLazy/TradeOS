/**
 * arbitrage-scanner.ts - 跨所套利扫描
 *
 * 监控同一币种在多个交易所的价差，发现套利机会时发送告警。
 * 仅提醒，不自动交易。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ExchangeManager } from './exchange-manager.js';

// ─── 类型定义 ───

export interface ArbitrageConfig {
  symbols: string[];               // 监控的交易对，如 ['BTC/USDT', 'ETH/USDT']
  exchanges: string[];             // 参与比较的交易所
  minProfitPercent: number;        // 最小净利润率阈值 (%)，默认 0.5
  feePercent: number;              // 单边手续费估算 (%)，默认 0.1
  cooldownMs: number;              // 同一机会的告警冷却时间 (ms)，默认 5 分钟
  pollingMs: number;               // 轮询间隔 (ms)，默认 30 秒
}

export interface ArbitrageOpportunity {
  symbol: string;
  buyExchange: string;             // 在此交易所买入（ask 最低）
  sellExchange: string;            // 在此交易所卖出（bid 最高）
  buyPrice: number;                // ask 价格
  sellPrice: number;               // bid 价格
  spreadPercent: number;           // 价差百分比
  netProfitPercent: number;        // 扣除手续费后的净利润率
  timestamp: number;
}

export interface ArbitrageAlert {
  opportunity: ArbitrageOpportunity;
  message: string;
  timestamp: number;
}

type ArbitrageAlertCallback = (alert: ArbitrageAlert) => void | Promise<void>;

// ─── 默认配置 ───

const DEFAULT_CONFIG: ArbitrageConfig = {
  symbols: ['BTC/USDT', 'ETH/USDT'],
  exchanges: ['binance', 'okx', 'bybit'],
  minProfitPercent: 0.5,
  feePercent: 0.1,
  cooldownMs: 5 * 60 * 1000,
  pollingMs: 30_000,
};

// ─── ArbitrageScanner 类 ───

export class ArbitrageScanner {
  private config: ArbitrageConfig;
  private configPath: string;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private getPassword: (() => string) | null = null;
  private callbacks: ArbitrageAlertCallback[] = [];
  private lastAlertTimes: Map<string, number> = new Map(); // "symbol:buyEx:sellEx" → timestamp
  private exchangeManager: ExchangeManager;

  constructor(dataDir: string, exchangeManager: ExchangeManager) {
    this.exchangeManager = exchangeManager;
    this.configPath = path.join(dataDir, 'arbitrage', 'config.json');
    this.config = { ...DEFAULT_CONFIG, ...this.loadConfig() };
  }

  // ─── 扫描器生命周期 ───

  /**
   * 启动扫描
   */
  start(getPassword: () => string): void {
    if (this.intervalId) return;
    this.getPassword = getPassword;

    this.intervalId = setInterval(() => {
      this.scan().catch(err =>
        console.error('[ArbitrageScanner] 扫描失败:', err.message)
      );
    }, this.config.pollingMs);

    // 立即执行一次
    this.scan().catch(() => {});
  }

  /**
   * 停止扫描
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.getPassword = null;
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  // ─── 配置管理 ───

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<ArbitrageConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();

    // 如果更新了轮询间隔且正在运行，重启
    if (updates.pollingMs && this.intervalId && this.getPassword) {
      this.stop();
      this.start(this.getPassword);
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): ArbitrageConfig {
    return { ...this.config };
  }

  /**
   * 添加监控交易对
   */
  addSymbol(symbol: string): void {
    if (!this.config.symbols.includes(symbol)) {
      this.config.symbols.push(symbol);
      this.saveConfig();
    }
  }

  /**
   * 移除监控交易对
   */
  removeSymbol(symbol: string): void {
    this.config.symbols = this.config.symbols.filter(s => s !== symbol);
    this.saveConfig();
  }

  /**
   * 手动扫描一次，返回所有发现的机会
   */
  async scanNow(masterPassword: string): Promise<ArbitrageOpportunity[]> {
    return this.findOpportunities(masterPassword);
  }

  /**
   * 注册告警回调
   */
  onAlert(callback: ArbitrageAlertCallback): void {
    this.callbacks.push(callback);
  }

  // ─── 核心扫描逻辑 ───

  private async scan(): Promise<void> {
    if (!this.getPassword) return;
    const masterPassword = this.getPassword();

    const opportunities = await this.findOpportunities(masterPassword);

    for (const opp of opportunities) {
      // 冷却期检查
      const key = `${opp.symbol}:${opp.buyExchange}:${opp.sellExchange}`;
      const lastAlert = this.lastAlertTimes.get(key) ?? 0;
      if (Date.now() - lastAlert < this.config.cooldownMs) continue;

      this.lastAlertTimes.set(key, Date.now());

      const coin = opp.symbol.split('/')[0];
      const alert: ArbitrageAlert = {
        opportunity: opp,
        message:
          `套利机会：${coin} 在 ${opp.buyExchange} 买入 $${opp.buyPrice.toFixed(2)}，` +
          `在 ${opp.sellExchange} 卖出 $${opp.sellPrice.toFixed(2)}，` +
          `净利润 ${opp.netProfitPercent.toFixed(2)}%`,
        timestamp: Date.now(),
      };

      await this.emitAlert(alert);
    }
  }

  private async findOpportunities(masterPassword: string): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    for (const symbol of this.config.symbols) {
      // 并行获取所有交易所的行情
      const tickerResults = await Promise.allSettled(
        this.config.exchanges.map(async (exchange) => {
          const ticker = await this.exchangeManager.getTicker(
            masterPassword, exchange, symbol
          );
          return { exchange, ask: ticker.ask, bid: ticker.bid };
        })
      );

      // 过滤成功的结果
      const tickers = tickerResults
        .filter((r): r is PromiseFulfilledResult<{ exchange: string; ask: number; bid: number }> =>
          r.status === 'fulfilled' && r.value.ask > 0 && r.value.bid > 0
        )
        .map(r => r.value);

      if (tickers.length < 2) continue;

      // 两两组合计算套利机会
      for (let i = 0; i < tickers.length; i++) {
        for (let j = 0; j < tickers.length; j++) {
          if (i === j) continue;

          const buyer = tickers[i];  // 在 ask 最低的交易所买入
          const seller = tickers[j]; // 在 bid 最高的交易所卖出

          // 利润 = 卖出价 - 买入价
          if (seller.bid <= buyer.ask) continue;

          const spreadPercent = ((seller.bid - buyer.ask) / buyer.ask) * 100;
          const netProfitPercent = spreadPercent - (this.config.feePercent * 2); // 双边手续费

          if (netProfitPercent >= this.config.minProfitPercent) {
            opportunities.push({
              symbol,
              buyExchange: buyer.exchange,
              sellExchange: seller.exchange,
              buyPrice: buyer.ask,
              sellPrice: seller.bid,
              spreadPercent,
              netProfitPercent,
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    // 按净利润率降序排列
    opportunities.sort((a, b) => b.netProfitPercent - a.netProfitPercent);
    return opportunities;
  }

  // ─── 事件通知 ───

  private async emitAlert(alert: ArbitrageAlert): Promise<void> {
    for (const cb of this.callbacks) {
      try {
        await cb(alert);
      } catch {
        // 回调失败不影响其他回调
      }
    }
  }

  // ─── 持久化 ───

  private loadConfig(): Partial<ArbitrageConfig> {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch { /* use defaults */ }
    return {};
  }

  private saveConfig(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    fs.chmodSync(this.configPath, 0o600);
  }
}
