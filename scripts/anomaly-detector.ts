/**
 * anomaly-detector.ts - 异常检测告警
 *
 * 监控账户异常行为：余额异常变动、未知订单、API 连接异常。
 * 通过回调发送告警。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ExchangeManager } from './exchange-manager.js';
import { KeyVault } from './key-vault.js';
import { sanitizeErrorMessage } from './security-utils.js';

// ─── 类型定义 ───

export type AnomalyType = 'balance_drop' | 'unknown_order' | 'api_failure';

export interface AnomalyConfig {
  enabled: boolean;
  balanceDropThresholdPercent: number;
  balanceCheckWindowMs: number;
  apiFailureThreshold: number;
  cooldownMs: number;
  pollingMs: number;
}

interface BalanceSnapshot {
  timestamp: number;
  totalUSD: number;
  byExchange: { exchangeId: string; totalUSD: number }[];
}

export interface AnomalyEvent {
  type: AnomalyType;
  severity: 'warning' | 'critical';
  message: string;
  data: Record<string, any>;
  timestamp: number;
}

type AnomalyAlertCallback = (event: AnomalyEvent) => void | Promise<void>;

// ─── 默认配置 ───

const DEFAULT_CONFIG: AnomalyConfig = {
  enabled: true,
  balanceDropThresholdPercent: 10,
  balanceCheckWindowMs: 5 * 60 * 1000,
  apiFailureThreshold: 5,
  cooldownMs: 30 * 60 * 1000,
  pollingMs: 60_000,
};

const MAX_SNAPSHOTS = 100;

// ─── AnomalyDetector 类 ───

export class AnomalyDetector {
  private config: AnomalyConfig;
  private configPath: string;
  private snapshotsPath: string;
  private snapshots: BalanceSnapshot[] = [];
  private apiFailureCounts: Map<string, number> = new Map();
  private lastAlertTimes: Map<string, number> = new Map();
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private getPassword: (() => string) | null = null;
  private callbacks: AnomalyAlertCallback[] = [];
  private exchangeManager: ExchangeManager;
  private vault: KeyVault;

  constructor(
    dataDir: string,
    exchangeManager: ExchangeManager,
    vault: KeyVault
  ) {
    this.exchangeManager = exchangeManager;
    this.vault = vault;

    const dir = path.join(dataDir, 'anomaly');
    this.configPath = path.join(dir, 'config.json');
    this.snapshotsPath = path.join(dir, 'snapshots.json');

    this.config = { ...DEFAULT_CONFIG, ...this.loadConfig() };
    this.loadSnapshots();
  }

  // ─── 生命周期 ───

  start(getPassword: () => string): void {
    if (this.timeoutId) return;
    this.getPassword = getPassword;

    const _poll = async () => {
      try {
        await this.detect();
      } catch (err: any) {
        console.error('[AnomalyDetector] 检测失败:', err.message);
      } finally {
        if (this.timeoutId !== null) {
          this.timeoutId = setTimeout(_poll, this.config.pollingMs);
        }
      }
    };

    this.timeoutId = setTimeout(_poll, 0);
  }

  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.getPassword = null;
  }

  isRunning(): boolean {
    return this.timeoutId !== null;
  }

  // ─── 配置管理 ───

  updateConfig(updates: Partial<AnomalyConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();

    if (updates.pollingMs && this.timeoutId && this.getPassword) {
      const getPassword = this.getPassword;
      this.stop();
      this.start(getPassword);
    }
  }

  getConfig(): AnomalyConfig {
    return { ...this.config };
  }

  onAlert(callback: AnomalyAlertCallback): void {
    this.callbacks.push(callback);
  }

  // ─── 核心检测逻辑 ───

  private async detect(): Promise<void> {
    if (!this.getPassword || !this.config.enabled) return;
    const masterPassword = this.getPassword();

    await this.checkBalanceDrop(masterPassword);
    await this.checkUnknownOrders(masterPassword);
  }

  /**
   * 余额异常变动检测
   */
  private async checkBalanceDrop(masterPassword: string): Promise<void> {
    let currentSnapshot: BalanceSnapshot;
    try {
      const { exchanges, totalUSD, failedExchanges } = await this.exchangeManager.getAllBalances(masterPassword);
      currentSnapshot = {
        timestamp: Date.now(),
        totalUSD,
        byExchange: exchanges.map(e => ({ exchangeId: e.exchangeId, totalUSD: e.totalUSD })),
      };

      // 重置所有交易所的 API 失败计数（getAllBalances 成功说明连接正常）
      for (const e of exchanges) {
        this.apiFailureCounts.set(e.exchangeId, 0);
      }

      // 部分交易所失败时跳过本轮余额异常检测，避免因不完整数据导致误报
      if (failedExchanges.length > 0) {
        for (const failed of failedExchanges) {
          await this.recordApiFailure(failed.exchangeId, failed.error);
        }
        return;
      }
    } catch (err: any) {
      // API 调用失败，记录失败次数
      await this.recordApiFailure('__all__', err.message);
      return;
    }

    // 保存快照
    this.snapshots.push(currentSnapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots.splice(0, this.snapshots.length - MAX_SNAPSHOTS);
    }
    this.saveSnapshots();

    // 查找窗口期内的参考快照
    const windowStart = Date.now() - this.config.balanceCheckWindowMs;
    const referenceSnapshot = this.snapshots.find(s => s.timestamp >= windowStart && s.timestamp < currentSnapshot.timestamp);
    if (!referenceSnapshot || referenceSnapshot.totalUSD <= 0) return;

    // 总资产变动检查
    const totalDropPercent = ((referenceSnapshot.totalUSD - currentSnapshot.totalUSD) / referenceSnapshot.totalUSD) * 100;

    if (totalDropPercent >= this.config.balanceDropThresholdPercent) {
      // 找出主要变动的交易所
      const details: string[] = [];
      for (const current of currentSnapshot.byExchange) {
        const ref = referenceSnapshot.byExchange.find(r => r.exchangeId === current.exchangeId);
        if (ref && ref.totalUSD > 0) {
          const drop = ((ref.totalUSD - current.totalUSD) / ref.totalUSD) * 100;
          if (drop > 5) {
            details.push(`${current.exchangeId}: -${drop.toFixed(1)}% ($${ref.totalUSD.toFixed(0)} → $${current.totalUSD.toFixed(0)})`);
          }
        }
      }

      await this.emitWithCooldown('balance_drop', {
        type: 'balance_drop',
        severity: 'critical',
        message:
          `异常告警：总资产在 ${Math.round(this.config.balanceCheckWindowMs / 60000)} 分钟内下降 ${totalDropPercent.toFixed(1)}%` +
          `（$${referenceSnapshot.totalUSD.toFixed(0)} → $${currentSnapshot.totalUSD.toFixed(0)}）` +
          (details.length > 0 ? `\n详情：${details.join('；')}` : ''),
        data: {
          previousUSD: referenceSnapshot.totalUSD,
          currentUSD: currentSnapshot.totalUSD,
          dropPercent: totalDropPercent,
          details,
        },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 未知订单检测
   */
  private async checkUnknownOrders(masterPassword: string): Promise<void> {
    try {
      const credentials = await this.vault.listCredentials(masterPassword);

      for (const cred of credentials) {
        try {
          const exchange = await this.exchangeManager.getExchange(
            masterPassword, cred.exchangeId, cred.label
          );

          // 获取最近的已成交订单（最近 1 小时内）
          const since = Date.now() - 60 * 60 * 1000;
          let recentOrders: any[];
          try {
            recentOrders = await exchange.fetchClosedOrders(undefined, since, 20);
          } catch {
            // 部分交易所不支持 fetchClosedOrders
            continue;
          }

          if (!recentOrders || recentOrders.length === 0) continue;

          // 检查是否有客户端 ID 不匹配的订单（简单启发式检测）
          // TradeOS 下的订单可以通过 clientOrderId 识别，但目前没有设置
          // 因此这里使用时间窗口 + 数量异常检测
          // 如果短时间内出现大量订单（>10笔），可能是异常
          if (recentOrders.length >= 10) {
            await this.emitWithCooldown(`unknown_order:${cred.exchangeId}`, {
              type: 'unknown_order',
              severity: 'warning',
              message: `异常提醒：${cred.exchangeId} 在最近 1 小时内有 ${recentOrders.length} 笔订单成交，请确认是否为本人操作`,
              data: {
                exchangeId: cred.exchangeId,
                orderCount: recentOrders.length,
                orders: recentOrders.slice(0, 5).map(o => ({
                  symbol: o.symbol,
                  side: o.side,
                  amount: o.amount,
                  price: o.price,
                  timestamp: o.timestamp,
                })),
              },
              timestamp: Date.now(),
            });
          }

          // 重置该交易所的 API 失败计数
          this.apiFailureCounts.set(cred.exchangeId, 0);
        } catch (err: any) {
          await this.recordApiFailure(cred.exchangeId, err.message);
        }
      }
    } catch {
      // listCredentials 失败，跳过
    }
  }

  /**
   * API 连续失败检测
   */
  private async recordApiFailure(exchangeId: string, errorMessage: string): Promise<void> {
    const sanitizedError = sanitizeErrorMessage(errorMessage);
    const count = (this.apiFailureCounts.get(exchangeId) ?? 0) + 1;
    this.apiFailureCounts.set(exchangeId, count);

    if (count >= this.config.apiFailureThreshold) {
      await this.emitWithCooldown(`api_failure:${exchangeId}`, {
        type: 'api_failure',
        severity: 'warning',
        message: `API 异常：${exchangeId} 连续 ${count} 次 API 调用失败，最近错误：${sanitizedError}。API Key 可能已过期或被禁用。`,
        data: {
          exchangeId,
          consecutiveFailures: count,
          lastError: sanitizedError,
        },
        timestamp: Date.now(),
      });
    }
  }

  // ─── 冷却与通知 ───

  private async emitWithCooldown(key: string, event: AnomalyEvent): Promise<void> {
    const lastAlert = this.lastAlertTimes.get(key) ?? 0;
    if (Date.now() - lastAlert < this.config.cooldownMs) return;

    this.lastAlertTimes.set(key, Date.now());
    await this.emitAlert(event);
  }

  private async emitAlert(event: AnomalyEvent): Promise<void> {
    for (const cb of this.callbacks) {
      try {
        await cb(event);
      } catch (err: any) {
        console.error('[AnomalyDetector] 告警回调失败:', err.message);
      }
    }
  }

  // ─── 持久化 ───

  private loadConfig(): Partial<AnomalyConfig> {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (err: any) {
      console.error('[AnomalyDetector] 加载配置失败:', err.message);
    }
    return {};
  }

  private saveConfig(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    fs.chmodSync(this.configPath, 0o600);
  }

  private loadSnapshots(): void {
    try {
      if (fs.existsSync(this.snapshotsPath)) {
        const raw = JSON.parse(fs.readFileSync(this.snapshotsPath, 'utf8'));
        if (Array.isArray(raw)) {
          this.snapshots = raw;
        }
      }
    } catch (err: any) {
      console.error('[AnomalyDetector] 加载余额快照失败:', err.message);
      this.snapshots = [];
    }
  }

  private saveSnapshots(): void {
    const dir = path.dirname(this.snapshotsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(this.snapshotsPath, JSON.stringify(this.snapshots, null, 2), 'utf8');
    fs.chmodSync(this.snapshotsPath, 0o600);
  }
}
