/**
 * pnl-tracker.ts - 损益追踪模块
 *
 * 基于资产快照计算指定周期的盈亏，
 * 支持按币种拆分、交易统计和净值曲线。
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { PortfolioTracker, type PortfolioDiff, type NetValuePoint } from './portfolio-tracker.js';

// ─── 类型定义 ───

export interface PnLReport {
  period: string;                // '1d' | '7d' | '30d' | 'custom'
  periodStart: number;
  periodEnd: number;
  startValue: number;
  endValue: number;
  pnlAbsolute: number;
  pnlPercent: number;
  byAsset: {
    coin: string;
    startValue: number;
    endValue: number;
    change: number;
    changePercent: number;
  }[];
  tradeStats: TradeStats;
  netValueCurve: NetValuePoint[];
}

export interface TradeStats {
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  winRate: number;
  totalFees: number;
  totalVolume: number;
}

export interface TradeRecord {
  id?: number;
  timestamp: number;
  exchange: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  cost: number;
  fee: number;
  pnl?: number;             // 平仓盈亏
}

// ─── PnLTracker 类 ───

export class PnLTracker {
  private db: Database.Database;
  private portfolioTracker: PortfolioTracker;

  constructor(dataDir: string, portfolioTracker: PortfolioTracker) {
    this.portfolioTracker = portfolioTracker;

    const dbDir = path.join(dataDir, 'data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(path.join(dbDir, 'trades.db'));
    this.initDB();
  }

  /**
   * 记录一笔交易
   */
  recordTrade(trade: Omit<TradeRecord, 'id'>): void {
    this.db.prepare(`
      INSERT INTO trades (timestamp, exchange, symbol, side, amount, price, cost, fee, pnl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.timestamp,
      trade.exchange,
      trade.symbol,
      trade.side,
      trade.amount,
      trade.price,
      trade.cost,
      trade.fee,
      trade.pnl ?? null
    );
  }

  /**
   * 生成损益报告
   */
  generateReport(period: '1d' | '7d' | '30d' | '90d'): PnLReport {
    const periodMs: Record<string, number> = {
      '1d': 1 * 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
    };

    const endTime = Date.now();
    const startTime = endTime - periodMs[period];

    // 资产变动
    const diff = this.portfolioTracker.getDiff(startTime, endTime);

    // 交易统计
    const tradeStats = this.getTradeStats(startTime, endTime);

    // 净值曲线
    const netValueCurve = this.portfolioTracker.getNetValueCurve(startTime, endTime);

    return {
      period,
      periodStart: startTime,
      periodEnd: endTime,
      startValue: diff?.startValue ?? 0,
      endValue: diff?.endValue ?? 0,
      pnlAbsolute: diff?.changeAbsolute ?? 0,
      pnlPercent: diff?.changePercent ?? 0,
      byAsset: diff?.byAsset ?? [],
      tradeStats,
      netValueCurve,
    };
  }

  /**
   * 自定义时段报告
   */
  generateCustomReport(startTime: number, endTime: number): PnLReport {
    const diff = this.portfolioTracker.getDiff(startTime, endTime);
    const tradeStats = this.getTradeStats(startTime, endTime);
    const netValueCurve = this.portfolioTracker.getNetValueCurve(startTime, endTime);

    return {
      period: 'custom',
      periodStart: startTime,
      periodEnd: endTime,
      startValue: diff?.startValue ?? 0,
      endValue: diff?.endValue ?? 0,
      pnlAbsolute: diff?.changeAbsolute ?? 0,
      pnlPercent: diff?.changePercent ?? 0,
      byAsset: diff?.byAsset ?? [],
      tradeStats,
      netValueCurve,
    };
  }

  /**
   * 查询交易历史
   */
  getTradeHistory(
    options: {
      exchange?: string;
      symbol?: string;
      startTime?: number;
      endTime?: number;
      limit?: number;
    } = {}
  ): TradeRecord[] {
    const { exchange, symbol, startTime, endTime, limit = 50 } = options;

    let sql = 'SELECT * FROM trades WHERE 1=1';
    const params: any[] = [];

    if (exchange) { sql += ' AND exchange = ?'; params.push(exchange); }
    if (symbol) { sql += ' AND symbol = ?'; params.push(symbol); }
    if (startTime) { sql += ' AND timestamp >= ?'; params.push(startTime); }
    if (endTime) { sql += ' AND timestamp <= ?'; params.push(endTime); }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params) as TradeRecord[];
  }

  /**
   * 格式化报告为可读文本
   */
  formatReport(report: PnLReport): string {
    const periodLabels: Record<string, string> = {
      '1d': '今日', '7d': '本周', '30d': '本月', '90d': '近三月', 'custom': '自定义',
    };

    const sign = report.pnlAbsolute >= 0 ? '+' : '';
    const emoji = report.pnlAbsolute >= 0 ? '📈' : '📉';

    let text = `${emoji} ${periodLabels[report.period] ?? report.period}收益报告\n`;
    text += `────────────────────\n`;
    text += `期初总资产: $${report.startValue.toFixed(2)}\n`;
    text += `当前总资产: $${report.endValue.toFixed(2)}\n`;
    text += `收益: ${sign}$${report.pnlAbsolute.toFixed(2)} (${sign}${report.pnlPercent.toFixed(2)}%)\n`;

    if (report.byAsset.length > 0) {
      text += `────────────────────\n`;
      text += `币种明细:\n`;
      for (const asset of report.byAsset.slice(0, 10)) {
        const s = asset.change >= 0 ? '+' : '';
        text += `  ${asset.coin}: ${s}$${asset.change.toFixed(2)} (${s}${asset.changePercent.toFixed(1)}%)\n`;
      }
    }

    if (report.tradeStats.totalTrades > 0) {
      text += `────────────────────\n`;
      text += `交易统计:\n`;
      text += `  总交易: ${report.tradeStats.totalTrades} 笔\n`;
      text += `  胜率: ${(report.tradeStats.winRate * 100).toFixed(1)}% (${report.tradeStats.winTrades}/${report.tradeStats.totalTrades})\n`;
      text += `  总手续费: $${report.tradeStats.totalFees.toFixed(2)}\n`;
    }

    return text;
  }

  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }

  // ─── 内部方法 ───

  private initDB(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        exchange TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        amount REAL NOT NULL,
        price REAL NOT NULL,
        cost REAL NOT NULL,
        fee REAL NOT NULL DEFAULT 0,
        pnl REAL
      );
      CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
      CREATE INDEX IF NOT EXISTS idx_trades_exchange ON trades(exchange);
    `);
  }

  private getTradeStats(startTime: number, endTime: number): TradeStats {
    const trades = this.db.prepare(
      'SELECT * FROM trades WHERE timestamp >= ? AND timestamp <= ?'
    ).all(startTime, endTime) as TradeRecord[];

    const winTrades = trades.filter(t => (t.pnl ?? 0) > 0).length;
    const lossTrades = trades.filter(t => (t.pnl ?? 0) < 0).length;
    const totalFees = trades.reduce((s, t) => s + t.fee, 0);
    const totalVolume = trades.reduce((s, t) => s + t.cost, 0);

    return {
      totalTrades: trades.length,
      winTrades,
      lossTrades,
      winRate: trades.length > 0 ? winTrades / trades.length : 0,
      totalFees,
      totalVolume,
    };
  }
}
