/**
 * balance-monitor.ts - 余额监控与告警
 *
 * 支持多种告警规则：价格告警、余额变动、资产跌幅、
 * 保证金率、资金费率等。通过 OpenClaw 消息通道发送通知。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ExchangeManager, type TickerInfo } from './exchange-manager.js';
import { PortfolioTracker } from './portfolio-tracker.js';

// ─── 类型定义 ───

export type AlertType =
  | 'price_above'            // 价格高于
  | 'price_below'            // 价格低于
  | 'balance_change'         // 某币种余额变动超过阈值
  | 'portfolio_drawdown'     // 总资产跌幅超过阈值
  | 'portfolio_gain'         // 总资产涨幅超过阈值
  | 'margin_ratio'           // 合约保证金率低于阈值
  | 'large_transfer';        // 大额资金转入/转出

export interface AlertRule {
  id: string;
  type: AlertType;
  name: string;              // 用户可读名称
  enabled: boolean;
  params: {
    coin?: string;           // 币种 (如 BTC)
    symbol?: string;         // 交易对 (如 BTC/USDT)
    exchange?: string;       // 交易所
    threshold: number;       // 阈值
    timeWindowMs?: number;   // 时间窗口 (ms)
  };
  cooldownMs: number;        // 触发后冷却时间
  lastTriggered: number;     // 上次触发时间
  createdAt: number;
}

export interface AlertEvent {
  rule: AlertRule;
  message: string;
  data: Record<string, any>;
  timestamp: number;
}

type AlertCallback = (event: AlertEvent) => void | Promise<void>;

// ─── BalanceMonitor 类 ───

export class BalanceMonitor {
  private rules: AlertRule[] = [];
  private configPath: string;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private pollingMs: number;
  private exchangeManager: ExchangeManager;
  private portfolioTracker: PortfolioTracker;
  private getPassword: (() => string) | null = null;
  private callbacks: AlertCallback[] = [];
  private lastBalances: Map<string, number> = new Map();  // coin -> total

  constructor(
    dataDir: string,
    exchangeManager: ExchangeManager,
    portfolioTracker: PortfolioTracker,
    pollingMs: number = 60_000   // 默认 60 秒
  ) {
    this.exchangeManager = exchangeManager;
    this.portfolioTracker = portfolioTracker;
    this.pollingMs = pollingMs;
    this.configPath = path.join(dataDir, 'alerts', 'rules.json');
    this.loadRules();
  }

  // ─── 监控生命周期 ───

  /**
   * 启动监控循环
   * @param getPassword 返回主密码的函数，避免明文存储密码
   */
  start(getPassword: () => string): void {
    if (this.timeoutId) return; // 已在运行
    this.getPassword = getPassword;

    const _poll = async () => {
      try {
        await this.checkAllRules();
      } catch (err: any) {
        console.error('[BalanceMonitor] 检查失败:', err.message);
      } finally {
        if (this.timeoutId !== null) { // 确保未被 stop 停止
          this.timeoutId = setTimeout(_poll, this.pollingMs);
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

  // ─── 规则管理 ───

  /**
   * 添加告警规则
   */
  addRule(rule: Omit<AlertRule, 'id' | 'lastTriggered' | 'createdAt'>): AlertRule {
    const fullRule: AlertRule = {
      ...rule,
      id: crypto.randomUUID(),
      lastTriggered: 0,
      createdAt: Date.now(),
    };
    this.rules.push(fullRule);
    this.saveRules();
    return fullRule;
  }

  /**
   * 删除告警规则
   */
  removeRule(ruleId: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter(r => r.id !== ruleId);
    if (this.rules.length < before) {
      this.saveRules();
      return true;
    }
    return false;
  }

  /**
   * 启用/禁用规则
   */
  toggleRule(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    this.saveRules();
    return true;
  }

  /**
   * 列出所有规则
   */
  listRules(): AlertRule[] {
    return [...this.rules];
  }

  /**
   * 注册告警回调（OpenClaw 通道会注册这个）
   */
  onAlert(callback: AlertCallback): void {
    this.callbacks.push(callback);
  }

  // ─── 规则检查 ───

  /**
   * 检查所有启用的规则
   */
  async checkAllRules(): Promise<AlertEvent[]> {
    if (!this.getPassword) return [];

    const events: AlertEvent[] = [];
    const enabledRules = this.rules.filter(r => r.enabled);

    for (const rule of enabledRules) {
      // 冷却期检查
      if (Date.now() - rule.lastTriggered < rule.cooldownMs) continue;

      try {
        const event = await this.checkRule(rule);
        if (event) {
          events.push(event);
          rule.lastTriggered = Date.now();
          this.saveRules();
          await this.emitAlert(event);
        }
      } catch (err: any) {
        console.warn(`[BalanceMonitor] 规则 ${rule.id} (${rule.name}) 检查失败:`, err.message);
      }
    }

    return events;
  }

  private async checkRule(rule: AlertRule): Promise<AlertEvent | null> {
    switch (rule.type) {
      case 'price_above':
      case 'price_below':
        return this.checkPriceRule(rule);

      case 'balance_change':
        return this.checkBalanceChangeRule(rule);

      case 'portfolio_drawdown':
      case 'portfolio_gain':
        return this.checkPortfolioRule(rule);

      case 'margin_ratio':
        return this.checkMarginRatioRule(rule);

      case 'large_transfer':
        return this.checkLargeTransferRule(rule);

      default:
        return null;
    }
  }

  private async checkPriceRule(rule: AlertRule): Promise<AlertEvent | null> {
    const { symbol, exchange, threshold } = rule.params;
    if (!symbol || !exchange) return null;

    const ticker = await this.exchangeManager.getTicker(
      this.getPassword!(), exchange, symbol
    );

    const triggered =
      (rule.type === 'price_above' && ticker.last >= threshold) ||
      (rule.type === 'price_below' && ticker.last <= threshold);

    if (!triggered) return null;

    const direction = rule.type === 'price_above' ? '突破' : '跌破';
    return {
      rule,
      message: `${symbol} 价格 ${direction} $${threshold}，当前价格 $${ticker.last.toFixed(2)}`,
      data: { price: ticker.last, threshold },
      timestamp: Date.now(),
    };
  }

  private async checkBalanceChangeRule(rule: AlertRule): Promise<AlertEvent | null> {
    const { coin, threshold } = rule.params;
    if (!coin) return null;

    const { aggregated } = await this.exchangeManager.getAllBalances(this.getPassword!());
    const current = aggregated.find(a => a.coin === coin);
    const currentTotal = current?.total ?? 0;

    const lastKey = `balance:${coin}`;
    const lastTotal = this.lastBalances.get(lastKey);
    this.lastBalances.set(lastKey, currentTotal);

    if (lastTotal === undefined) return null; // 首次记录，不告警

    const changePct = lastTotal > 0
      ? Math.abs((currentTotal - lastTotal) / lastTotal) * 100
      : 0;

    if (changePct < threshold) return null;

    const direction = currentTotal > lastTotal ? '增加' : '减少';
    return {
      rule,
      message: `${coin} 余额${direction} ${changePct.toFixed(1)}%（${lastTotal.toFixed(4)} → ${currentTotal.toFixed(4)}）`,
      data: { coin, previous: lastTotal, current: currentTotal, changePct },
      timestamp: Date.now(),
    };
  }

  private async checkPortfolioRule(rule: AlertRule): Promise<AlertEvent | null> {
    const { threshold, timeWindowMs } = rule.params;
    const window = timeWindowMs ?? 24 * 60 * 60 * 1000; // 默认 24h

    const latestSnap = this.portfolioTracker.getLatestSnapshot();
    if (!latestSnap) return null;

    const curve = this.portfolioTracker.getNetValueCurve(
      Date.now() - window, Date.now()
    );
    if (curve.length === 0) return null;

    const startValue = curve[0].totalUSD;
    const endValue = latestSnap.totalUSD;
    const changePct = startValue > 0
      ? ((endValue - startValue) / startValue) * 100
      : 0;

    const triggered =
      (rule.type === 'portfolio_drawdown' && changePct <= -threshold) ||
      (rule.type === 'portfolio_gain' && changePct >= threshold);

    if (!triggered) return null;

    const windowLabel = window >= 86400000
      ? `${Math.round(window / 86400000)}天`
      : `${Math.round(window / 3600000)}小时`;

    const direction = changePct > 0 ? '上涨' : '下跌';
    return {
      rule,
      message: `总资产 ${windowLabel}内${direction} ${Math.abs(changePct).toFixed(1)}%（$${startValue.toFixed(0)} → $${endValue.toFixed(0)}）`,
      data: { startValue, endValue, changePct, windowMs: window },
      timestamp: Date.now(),
    };
  }

  private async checkMarginRatioRule(rule: AlertRule): Promise<AlertEvent | null> {
    const { exchange, threshold } = rule.params;
    if (!exchange) return null;

    const ex = await this.exchangeManager.getExchange(this.getPassword!(), exchange);
    let balance: Record<string, any>;

    // 尝试优先读取合约账户保证金信息
    try {
      balance = await ex.fetchBalance({ type: 'future' });
    } catch {
      balance = await ex.fetchBalance();
    }

    const rawRatio = this.extractMarginRatio(balance);
    if (rawRatio === null) return null;

    const ratioPercent = rawRatio <= 1 ? rawRatio * 100 : rawRatio;
    if (ratioPercent > threshold) return null;

    return {
      rule,
      message: `${exchange} 保证金率告警：当前 ${ratioPercent.toFixed(2)}%，低于阈值 ${threshold.toFixed(2)}%`,
      data: {
        exchange,
        marginRatioPercent: ratioPercent,
        thresholdPercent: threshold,
      },
      timestamp: Date.now(),
    };
  }

  private async checkLargeTransferRule(rule: AlertRule): Promise<AlertEvent | null> {
    const { coin, exchange, threshold } = rule.params;
    if (!coin) return null;

    const normalizedCoin = coin.toUpperCase();
    const { exchanges, aggregated } = await this.exchangeManager.getAllBalances(this.getPassword!());
    let currentTotal: number;

    if (exchange) {
      currentTotal = exchanges
        .filter(e => e.exchangeId === exchange)
        .reduce((sum, e) => {
          const item = e.balances.find(b => b.coin.toUpperCase() === normalizedCoin);
          return sum + (item?.total ?? 0);
        }, 0);
    } else {
      currentTotal = aggregated.find(a => a.coin.toUpperCase() === normalizedCoin)?.total ?? 0;
    }

    const lastKey = `transfer:${exchange ?? 'all'}:${normalizedCoin}`;
    const lastTotal = this.lastBalances.get(lastKey);
    this.lastBalances.set(lastKey, currentTotal);
    if (lastTotal === undefined) return null;

    const delta = currentTotal - lastTotal;
    if (Math.abs(delta) < threshold) return null;

    const direction = delta > 0 ? '转入/增加' : '转出/减少';
    return {
      rule,
      message: `${normalizedCoin} 发生大额${direction}：${Math.abs(delta).toFixed(6)} ${normalizedCoin}（${lastTotal.toFixed(6)} → ${currentTotal.toFixed(6)}）`,
      data: {
        coin: normalizedCoin,
        exchange: exchange ?? 'all',
        previous: lastTotal,
        current: currentTotal,
        delta,
        threshold,
      },
      timestamp: Date.now(),
    };
  }

  private extractMarginRatio(balance: Record<string, any>): number | null {
    const candidates = [
      balance.marginRatio,
      balance.marginLevel,
      balance.info?.marginRatio,
      balance.info?.margin_level,
      balance.info?.riskRate,
      balance.info?.risk_ratio,
    ];

    for (const value of candidates) {
      if (value === undefined || value === null || value === '') continue;
      const ratio = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(ratio) && ratio > 0) {
        return ratio;
      }
    }

    return null;
  }

  // ─── 通知 ───

  private async emitAlert(event: AlertEvent): Promise<void> {
    for (const cb of this.callbacks) {
      try {
        await cb(event);
      } catch (err: any) {
        console.error(`[BalanceMonitor] 告警回调失败 (规则 ${event.rule.id}):`, err.message);
      }
    }
  }

  // ─── 持久化 ───

  private loadRules(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        this.rules = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (err: any) {
      console.error('[BalanceMonitor] 加载规则失败，使用默认空规则:', err.message);
      this.rules = [];
    }
  }

  private saveRules(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.rules, null, 2), 'utf8');
    fs.chmodSync(this.configPath, 0o600);
  }
}
