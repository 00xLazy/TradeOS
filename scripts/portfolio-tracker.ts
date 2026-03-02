/**
 * portfolio-tracker.ts - 资产总览与快照
 *
 * 定期保存资产快照到 SQLite，支持历史对比和净值曲线。
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ExchangeManager, type ExchangeBalance, type FormattedBalance } from './exchange-manager.js';

// ─── 类型定义 ───

export interface PortfolioSnapshot {
  id?: number;
  timestamp: number;
  totalUSD: number;
  exchanges: ExchangeBalance[];
  aggregated: FormattedBalance[];
}

export interface PortfolioDiff {
  periodStart: number;
  periodEnd: number;
  startValue: number;
  endValue: number;
  changeAbsolute: number;
  changePercent: number;
  byAsset: {
    coin: string;
    startValue: number;
    endValue: number;
    change: number;
    changePercent: number;
  }[];
}

export interface NetValuePoint {
  timestamp: number;
  totalUSD: number;
}

// ─── PortfolioTracker 类 ───

export class PortfolioTracker {
  private db: Database.Database;
  private exchangeManager: ExchangeManager;

  constructor(dataDir: string, exchangeManager: ExchangeManager) {
    this.exchangeManager = exchangeManager;

    const dbDir = path.join(dataDir, 'data');
    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    } catch (err: any) {
      console.error(`[PortfolioTracker] 无法创建数据目录 ${dbDir}:`, err.message);
      throw err; // 致命错误，无法继续
    }

    const dbPath = path.join(dbDir, 'portfolio.db');
    try {
      this.db = new Database(dbPath);
      this.initDB();
    } catch (err: any) {
      console.error(`[PortfolioTracker] 无法初始化数据库 ${dbPath}:`, err.message);
      throw err; // 致命错误，无法继续
    }

    // 设置数据库文件权限为 600（仅 owner 可读写）
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch (err: any) {
      console.warn(`[PortfolioTracker] 无法设置数据库文件权限 ${dbPath}:`, err.message);
    }
  }

  /**
   * 拍摄当前资产快照
   */
  async takeSnapshot(masterPassword: string): Promise<PortfolioSnapshot> {
    const { exchanges, totalUSD, aggregated } =
      await this.exchangeManager.getAllBalances(masterPassword);

    const snapshot: PortfolioSnapshot = {
      timestamp: Date.now(),
      totalUSD,
      exchanges,
      aggregated,
    };

    this.saveSnapshot(snapshot);
    return snapshot;
  }

  /**
   * 获取最新的快照
   */
  getLatestSnapshot(): PortfolioSnapshot | null {
    const row = this.db.prepare(
      'SELECT * FROM snapshots ORDER BY timestamp DESC LIMIT 1'
    ).get() as any;

    if (!row) return null;
    return this.rowToSnapshot(row);
  }

  /**
   * 获取指定时间范围的净值曲线
   */
  getNetValueCurve(startTime: number, endTime: number): NetValuePoint[] {
    const rows = this.db.prepare(
      'SELECT timestamp, total_usd FROM snapshots WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC'
    ).all(startTime, endTime) as any[];

    return rows.map(r => ({
      timestamp: r.timestamp,
      totalUSD: r.total_usd,
    }));
  }

  /**
   * 对比两个时间点的资产变化
   */
  getDiff(startTime: number, endTime: number): PortfolioDiff | null {
    // 最大偏差为查询周期的 20%，但至少 1 小时
    const period = endTime - startTime;
    const maxDeviation = Math.max(period * 0.2, 60 * 60 * 1000);

    const startSnap = this.getClosestSnapshot(startTime, maxDeviation);
    const endSnap = this.getClosestSnapshot(endTime, maxDeviation);

    if (!startSnap || !endSnap) return null;

    const changeAbsolute = endSnap.totalUSD - startSnap.totalUSD;
    const changePercent = startSnap.totalUSD > 0
      ? (changeAbsolute / startSnap.totalUSD) * 100
      : 0;

    // 按币种对比
    const startMap = new Map(startSnap.aggregated.map(a => [a.coin, a]));
    const endMap = new Map(endSnap.aggregated.map(a => [a.coin, a]));
    const allCoins = new Set([...startMap.keys(), ...endMap.keys()]);

    const byAsset = Array.from(allCoins).map(coin => {
      const sv = startMap.get(coin)?.valueUSD ?? 0;
      const ev = endMap.get(coin)?.valueUSD ?? 0;
      return {
        coin,
        startValue: sv,
        endValue: ev,
        change: ev - sv,
        changePercent: sv > 0 ? ((ev - sv) / sv) * 100 : (ev > 0 ? 100 : 0),
      };
    }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    return {
      periodStart: startSnap.timestamp,
      periodEnd: endSnap.timestamp,
      startValue: startSnap.totalUSD,
      endValue: endSnap.totalUSD,
      changeAbsolute,
      changePercent,
      byAsset,
    };
  }

  /**
   * 获取过去 N 天的每日快照摘要
   */
  getDailySummary(days: number): NetValuePoint[] {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this.db.prepare(`
      SELECT
        (timestamp / 86400000) * 86400000 AS day_ts,
        AVG(total_usd) AS avg_usd
      FROM snapshots
      WHERE timestamp >= ?
      GROUP BY day_ts
      ORDER BY day_ts ASC
    `).all(since) as any[];

    return rows.map(r => ({
      timestamp: r.day_ts,
      totalUSD: r.avg_usd,
    }));
  }

  /**
   * 清理过期快照（保留最近 N 天）
   */
  pruneSnapshots(keepDays: number = 90): number {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      'DELETE FROM snapshots WHERE timestamp < ?'
    ).run(cutoff);
    return result.changes;
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
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        total_usd REAL NOT NULL,
        detail_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(timestamp);
    `);
  }

  private saveSnapshot(snapshot: PortfolioSnapshot): void {
    this.db.prepare(
      'INSERT INTO snapshots (timestamp, total_usd, detail_json) VALUES (?, ?, ?)'
    ).run(
      snapshot.timestamp,
      snapshot.totalUSD,
      JSON.stringify({ exchanges: snapshot.exchanges, aggregated: snapshot.aggregated })
    );
  }

  private getClosestSnapshot(targetTime: number, maxDeviationMs?: number): PortfolioSnapshot | null {
    const row = this.db.prepare(
      'SELECT * FROM snapshots ORDER BY ABS(timestamp - ?) ASC LIMIT 1'
    ).get(targetTime) as any;

    if (!row) return null;

    // 如果指定了最大偏差，检查快照时间是否在可接受范围内
    if (maxDeviationMs !== undefined) {
      const deviation = Math.abs(row.timestamp - targetTime);
      if (deviation > maxDeviationMs) return null;
    }

    return this.rowToSnapshot(row);
  }

  private rowToSnapshot(row: any): PortfolioSnapshot {
    const detail = JSON.parse(row.detail_json);
    return {
      id: row.id,
      timestamp: row.timestamp,
      totalUSD: row.total_usd,
      exchanges: detail.exchanges ?? [],
      aggregated: detail.aggregated ?? [],
    };
  }
}
