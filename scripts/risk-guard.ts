/**
 * risk-guard.ts - 风控模块
 *
 * 对每一笔交易进行风险检查，包括单笔限额、日累计限额、
 * 杠杆限制、滑点保护、冷却期等。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { OrderRequest } from './order-executor.js';

// ─── 类型定义 ───

export interface RiskRules {
  maxOrderValueUSD: number;       // 单笔最大金额 (USD)
  maxDailyVolumeUSD: number;      // 单日累计最大交易量 (USD)
  maxLeverage: number;            // 最大杠杆倍数
  maxSlippagePercent: number;     // 最大滑点 (%)
  confirmThresholdUSD: number;    // 超过此金额需强制二次确认
  blockedSymbols: string[];       // 禁止交易的交易对
  cooldownSeconds: number;        // 同一交易对连续下单冷却 (秒)
}

export interface RiskCheckResult {
  passed: boolean;
  blocked: boolean;
  reasons: string[];              // 拦截原因
  warnings: string[];             // 警告（不拦截但提醒）
  requiresConfirmation: boolean;  // 是否需要二次确认
}

interface TradeRecord {
  symbol: string;
  costUSD: number;
  timestamp: number;
}

// ─── 默认风控规则 ───

const DEFAULT_RULES: RiskRules = {
  maxOrderValueUSD: 10_000,
  maxDailyVolumeUSD: 50_000,
  maxLeverage: 10,
  maxSlippagePercent: 1.0,
  confirmThresholdUSD: 500,
  blockedSymbols: [],
  cooldownSeconds: 30,
};

// ─── RiskGuard 类 ───

export class RiskGuard {
  private rules: RiskRules;
  private todayTrades: TradeRecord[] = [];
  private configPath: string;
  private tradesPath: string;

  constructor(dataDir: string, customRules?: Partial<RiskRules>) {
    this.configPath = path.join(dataDir, 'risk-rules.json');
    this.tradesPath = path.join(dataDir, 'daily-trades.json');
    this.rules = this.normalizeRules({ ...DEFAULT_RULES, ...this.loadRules(), ...customRules });
    this.loadTrades();
  }

  /**
   * 检查订单是否通过风控
   */
  checkOrder(request: OrderRequest, estimatedCostUSD: number, currentMarketPrice: number): RiskCheckResult {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let blocked = false;

    const normalizedSymbol = request.symbol.toUpperCase();
    // 1) 黑名单检查
    if (this.rules.blockedSymbols.includes(normalizedSymbol)) {
      reasons.push(`${request.symbol} 在交易黑名单中`);
      blocked = true;
    }

    // 2) 单笔限额
    if (estimatedCostUSD > this.rules.maxOrderValueUSD) {
      reasons.push(
        `单笔金额 $${estimatedCostUSD.toFixed(2)} 超过限额 $${this.rules.maxOrderValueUSD}`
      );
      blocked = true;
    }

    // 3) 日累计限额
    const todayVolume = this.getTodayVolume();
    if (todayVolume + estimatedCostUSD > this.rules.maxDailyVolumeUSD) {
      reasons.push(
        `今日累计交易量将达 $${(todayVolume + estimatedCostUSD).toFixed(2)}，` +
        `超过日限额 $${this.rules.maxDailyVolumeUSD}`
      );
      blocked = true;
    }

    // 4) 杠杆检查
    if (request.market === 'futures' && request.leverage) {
      if (request.leverage > this.rules.maxLeverage) {
        reasons.push(
          `杠杆 ${request.leverage}x 超过最大限制 ${this.rules.maxLeverage}x`
        );
        blocked = true;
      }
      if (request.leverage > 5) {
        warnings.push(`杠杆 ${request.leverage}x 较高，请注意爆仓风险`);
      }
    }

    // 5) 冷却期检查
    const lastTrade = this.getLastTradeForSymbol(request.symbol);
    if (lastTrade) {
      const elapsed = (Date.now() - lastTrade.timestamp) / 1000;
      if (elapsed < this.rules.cooldownSeconds) {
        const remaining = Math.ceil(this.rules.cooldownSeconds - elapsed);
        reasons.push(`距离上次 ${request.symbol} 交易仅 ${Math.floor(elapsed)}s，冷却期剩余 ${remaining}s`);
        blocked = true;
      }
    }

    // 6) 滑点检查 (仅限市价买单)
    if (request.type === 'market' && request.side === 'buy' && estimatedCostUSD > 0 && request.amount > 0 && currentMarketPrice > 0) {
      const impliedPrice = estimatedCostUSD / request.amount;
      const slippage = (impliedPrice / currentMarketPrice - 1) * 100; // 百分比
      if (slippage > this.rules.maxSlippagePercent) {
        reasons.push(
          `市价买单预估滑点 ${slippage.toFixed(2)}% 超过限额 ${this.rules.maxSlippagePercent}%。` +
          `预估买入价 $${impliedPrice.toFixed(2)} vs 市场价 $${currentMarketPrice.toFixed(2)}。`
        );
        blocked = true;
      }
    } else if (request.type === 'market' && request.side === 'sell' && estimatedCostUSD > 0 && request.amount > 0 && currentMarketPrice > 0) {
      const impliedPrice = estimatedCostUSD / request.amount;
      const slippage = (1 - impliedPrice / currentMarketPrice) * 100; // 百分比
      if (slippage > this.rules.maxSlippagePercent) {
        reasons.push(
          `市价卖单预估滑点 ${slippage.toFixed(2)}% 超过限额 ${this.rules.maxSlippagePercent}%。` +
          `预估卖出价 $${impliedPrice.toFixed(2)} vs 市场价 $${currentMarketPrice.toFixed(2)}。`
        );
        blocked = true;
      }
    }

    // 7) 大额市价单警告 (原 6)
    if (request.type === 'market' && estimatedCostUSD > 5000) {
      warnings.push('大额市价单可能产生较大滑点，建议使用限价单');
    }

    // 8) 二次确认判定 (原 7)
    const requiresConfirmation =
      estimatedCostUSD > this.rules.confirmThresholdUSD ||
      request.market === 'futures' ||
      warnings.length > 0;

    return {
      passed: !blocked,
      blocked,
      reasons,
      warnings,
      requiresConfirmation,
    };
  }

  /**
   * 记录已执行的交易（用于日累计统计）
   */
  recordTrade(costUSD: number, symbol?: string): void {
    this.todayTrades.push({
      symbol: symbol ?? 'UNKNOWN',
      costUSD,
      timestamp: Date.now(),
    });
    this.cleanOldTrades();
    this.saveTrades();
  }

  /**
   * 获取今日已交易总量
   */
  getTodayVolume(): number {
    this.cleanOldTrades();
    return this.todayTrades.reduce((sum, t) => sum + t.costUSD, 0);
  }

  /**
   * 获取当前风控规则
   */
  getRules(): Readonly<RiskRules> {
    return { ...this.rules };
  }

  /**
   * 更新风控规则
   */
  updateRules(updates: Partial<RiskRules>): void {
    this.rules = this.normalizeRules({ ...this.rules, ...updates });
    this.saveRules();
  }

  /**
   * 重置为默认规则
   */
  resetRules(): void {
    this.rules = this.normalizeRules({ ...DEFAULT_RULES });
    this.saveRules();
  }

  // ─── 内部方法 ───

  private getLastTradeForSymbol(symbol: string): TradeRecord | undefined {
    for (let i = this.todayTrades.length - 1; i >= 0; i--) {
      if (this.todayTrades[i].symbol === symbol) {
        return this.todayTrades[i];
      }
    }
    return undefined;
  }

  private cleanOldTrades(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.todayTrades = this.todayTrades.filter(t => t.timestamp > oneDayAgo);
  }

  private loadRules(): Partial<RiskRules> {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch { /* use defaults */ }
    return {};
  }

  private saveRules(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.rules, null, 2), 'utf8');
    fs.chmodSync(this.configPath, 0o600);
  }

  private loadTrades(): void {
    try {
      if (fs.existsSync(this.tradesPath)) {
        const raw = JSON.parse(fs.readFileSync(this.tradesPath, 'utf8'));
        if (Array.isArray(raw)) {
          this.todayTrades = raw;
          this.cleanOldTrades();
        }
      }
    } catch { /* start fresh */ }
  }

  private saveTrades(): void {
    const dir = path.dirname(this.tradesPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.tradesPath, JSON.stringify(this.todayTrades), 'utf8');
    fs.chmodSync(this.tradesPath, 0o600);
  }

  private normalizeRules(rules: RiskRules): RiskRules {
    const blockedSymbols = Array.isArray(rules.blockedSymbols)
      ? Array.from(new Set(
        rules.blockedSymbols
          .map(s => s.toUpperCase().trim())
          .filter(Boolean)
      ))
      : [];

    return {
      ...rules,
      blockedSymbols,
    };
  }
}
