/**
 * funding-rate-monitor.ts - 资金费率监控
 *
 * 监控永续合约资金费率，发现年化收益率超过阈值时发送告警。
 * 仅提醒，不自动交易。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ExchangeManager } from './exchange-manager.js';

// ─── 类型定义 ───

export interface FundingRateConfig {
  symbols: string[];               // 监控的永续合约，如 ['BTC/USDT:USDT', 'ETH/USDT:USDT']
  exchanges: string[];             // 监控的交易所
  annualizedThreshold: number;     // 年化收益率告警阈值 (%)，默认 30
  cooldownMs: number;              // 同一机会的告警冷却时间 (ms)，默认 1 小时
  pollingMs: number;               // 轮询间隔 (ms)，默认 5 分钟
}

export interface FundingRateInfo {
  exchange: string;
  symbol: string;
  currentRate: number;             // 当前费率（如 0.0001 = 0.01%）
  annualizedRate: number;          // 年化费率 (%)
  nextFundingTime: number;         // 下次结算时间 (Unix ms)
  intervalHours: number;           // 结算间隔（小时）
  timestamp: number;
}

export type FundingDirection = 'short' | 'long';

export interface FundingRateOpportunity {
  exchange: string;
  symbol: string;
  currentRate: number;
  annualizedRate: number;
  direction: FundingDirection;     // short = 做空收费率, long = 做多收费率
  suggestion: string;              // 建议描述
  timestamp: number;
}

export interface FundingRateAlert {
  opportunity: FundingRateOpportunity;
  message: string;
  timestamp: number;
}

type FundingRateAlertCallback = (alert: FundingRateAlert) => void | Promise<void>;

// ─── 默认配置 ───

const DEFAULT_CONFIG: FundingRateConfig = {
  symbols: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
  exchanges: ['binance', 'okx', 'bybit'],
  annualizedThreshold: 30,
  cooldownMs: 60 * 60 * 1000, // 1 小时
  pollingMs: 5 * 60 * 1000,   // 5 分钟
};

// 一年的小时数（365.25 * 24）
const HOURS_PER_YEAR = 8766;

// ─── FundingRateMonitor 类 ───

export class FundingRateMonitor {
  private config: FundingRateConfig;
  private configPath: string;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private getPassword: (() => string) | null = null;
  private callbacks: FundingRateAlertCallback[] = [];
  private lastAlertTimes: Map<string, number> = new Map(); // "exchange:symbol" → timestamp
  private exchangeManager: ExchangeManager;

  constructor(dataDir: string, exchangeManager: ExchangeManager) {
    this.exchangeManager = exchangeManager;
    this.configPath = path.join(dataDir, 'funding', 'config.json');
    this.config = { ...DEFAULT_CONFIG, ...this.loadConfig() };
  }

  // ─── 监控生命周期 ───

  /**
   * 启动监控
   */
  start(getPassword: () => string): void {
    if (this.timeoutId) return;
    this.getPassword = getPassword;

    const _poll = async () => {
      try {
        await this.scan();
      } catch (err: any) {
        console.error('[FundingRateMonitor] 扫描失败:', err.message);
      } finally {
        if (this.timeoutId !== null) { // 确保未被 stop 停止
          this.timeoutId = setTimeout(_poll, this.config.pollingMs);
        }
      }
    };

    // 立即执行一次并启动循环
    this.timeoutId = setTimeout(_poll, 0);
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.getPassword = null;
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.timeoutId !== null;
  }

  // ─── 配置管理 ───

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<FundingRateConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();

    // 如果更新了轮询间隔且正在运行，重启
    if (updates.pollingMs && this.timeoutId && this.getPassword) {
      this.stop();
      this.start(this.getPassword);
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): FundingRateConfig {
    return { ...this.config };
  }

  /**
   * 添加监控交易对（永续合约格式，如 'BTC/USDT:USDT'）
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
   * 查询所有监控交易对的当前费率
   */
  async fetchCurrentRates(masterPassword: string): Promise<FundingRateInfo[]> {
    const rates: FundingRateInfo[] = [];

    for (const exchange of this.config.exchanges) {
      const results = await Promise.allSettled(
        this.config.symbols.map(symbol =>
          this.fetchRate(masterPassword, exchange, symbol)
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          rates.push(result.value);
        }
      }
    }

    return rates;
  }

  /**
   * 手动扫描一次，返回所有超过阈值的机会
   */
  async scanNow(masterPassword: string): Promise<FundingRateOpportunity[]> {
    const rates = await this.fetchCurrentRates(masterPassword);
    return this.findOpportunities(rates);
  }

  /**
   * 注册告警回调
   */
  onAlert(callback: FundingRateAlertCallback): void {
    this.callbacks.push(callback);
  }

  // ─── 核心扫描逻辑 ───

  private async scan(): Promise<void> {
    if (!this.getPassword) return;
    const masterPassword = this.getPassword();

    const rates = await this.fetchCurrentRates(masterPassword);
    const opportunities = this.findOpportunities(rates);

    for (const opp of opportunities) {
      // 冷却期检查
      const key = `${opp.exchange}:${opp.symbol}`;
      const lastAlert = this.lastAlertTimes.get(key) ?? 0;
      if (Date.now() - lastAlert < this.config.cooldownMs) continue;

      this.lastAlertTimes.set(key, Date.now());

      const coin = opp.symbol.split('/')[0];
      const rateDisplay = (opp.currentRate * 100).toFixed(4);
      const alert: FundingRateAlert = {
        opportunity: opp,
        message:
          `资金费率机会：${opp.exchange} ${coin} 当前费率 ${rateDisplay}%，` +
          `年化 ${opp.annualizedRate.toFixed(1)}%，` +
          `建议${opp.direction === 'short' ? '做空' : '做多'}收取费率`,
        timestamp: Date.now(),
      };

      await this.emitAlert(alert);
    }
  }

  private async fetchRate(
    masterPassword: string,
    exchangeId: string,
    symbol: string
  ): Promise<FundingRateInfo | null> {
    try {
      const exchange = await this.exchangeManager.getExchange(
        masterPassword, exchangeId
      );

      const fundingRate = await exchange.fetchFundingRate(symbol);
      if (!fundingRate || fundingRate.fundingRate === undefined) return null;

      const rate = fundingRate.fundingRate;
      // 默认 8 小时结算，部分交易所可能不同
      const intervalHours = fundingRate.fundingDatetime && fundingRate.datetime
        ? Math.max(
            Math.round(
              (new Date(fundingRate.fundingDatetime).getTime() - new Date(fundingRate.datetime).getTime()) / 3600000
            ),
            1
          )
        : 8;

      const annualizedRate = Math.abs(rate) * (HOURS_PER_YEAR / intervalHours) * 100;

      return {
        exchange: exchangeId,
        symbol,
        currentRate: rate,
        annualizedRate,
        nextFundingTime: fundingRate.fundingTimestamp ?? 0,
        intervalHours,
        timestamp: Date.now(),
      };
    } catch (err: any) {
      console.warn(`[FundingRateMonitor] 从 ${exchangeId} 获取 ${symbol} 资金费率失败:`, err.message);
      return null;
    }
  }

  private findOpportunities(rates: FundingRateInfo[]): FundingRateOpportunity[] {
    const opportunities: FundingRateOpportunity[] = [];

    for (const rate of rates) {
      if (rate.annualizedRate < this.config.annualizedThreshold) continue;

      const direction: FundingDirection = rate.currentRate > 0 ? 'short' : 'long';
      const coin = rate.symbol.split('/')[0];

      const suggestion = rate.currentRate > 0
        ? `做空 ${coin} 永续合约，收取多头支付的资金费率`
        : `做多 ${coin} 永续合约，收取空头支付的资金费率`;

      opportunities.push({
        exchange: rate.exchange,
        symbol: rate.symbol,
        currentRate: rate.currentRate,
        annualizedRate: rate.annualizedRate,
        direction,
        suggestion,
        timestamp: Date.now(),
      });
    }

    // 按年化费率降序
    opportunities.sort((a, b) => b.annualizedRate - a.annualizedRate);
    return opportunities;
  }

  // ─── 事件通知 ───

  private async emitAlert(alert: FundingRateAlert): Promise<void> {
    for (const cb of this.callbacks) {
      try {
        await cb(alert);
      } catch (err: any) {
        console.error(`[FundingRateMonitor] 告警回调失败 (资金费率机会 ${alert.opportunity.symbol}):`, err.message);
      }
    }
  }

  // ─── 持久化 ───

  private loadConfig(): Partial<FundingRateConfig> {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (err: any) {
      console.error('[FundingRateMonitor] 加载资金费率配置失败，使用默认配置:', err.message);
    }
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
