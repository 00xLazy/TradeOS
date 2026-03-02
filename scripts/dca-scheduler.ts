/**
 * dca-scheduler.ts - DCA 定投调度器
 *
 * 支持按小时/日/周/月周期自动定投，
 * 自动执行 previewOrder → executeOrder 流程（创建计划时已授权）。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ExchangeManager } from './exchange-manager.js';
import { OrderExecutor, type OrderRequest, type OrderResult } from './order-executor.js';

// ─── 类型定义 ───

export type DcaFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

export type DcaPlanStatus = 'active' | 'paused' | 'completed';

export interface DcaPlan {
  id: string;
  name: string;
  exchangeId: string;
  symbol: string;             // 如 'BTC/USDT'
  amountUSDT: number;         // 每次定投金额 (USDT)
  frequency: DcaFrequency;
  /** 执行时间 — daily: 0-23 小时; weekly: 0-6 星期几; monthly: 1-28 日 */
  executionTime: number;
  status: DcaPlanStatus;
  nextExecutionAt: number;    // 下次执行的 Unix 时间戳 (ms)
  createdAt: number;
  totalExecutions: number;
  totalSpentUSDT: number;
  totalAcquired: number;      // 累计买入的标的币数量
}

export interface DcaExecutionRecord {
  planId: string;
  timestamp: number;
  status: 'success' | 'failed' | 'skipped';
  amountUSDT: number;
  price: number;
  acquired: number;           // 本次买入的标的币数量
  orderId?: string;
  error?: string;
}

export interface DcaPlanSummary {
  plan: DcaPlan;
  avgBuyPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  recentExecutions: DcaExecutionRecord[];
}

export type DcaEventType = 'execution_success' | 'execution_failed' | 'plan_completed';

export interface DcaEvent {
  type: DcaEventType;
  plan: DcaPlan;
  execution?: DcaExecutionRecord;
  message: string;
  timestamp: number;
}

type DcaEventCallback = (event: DcaEvent) => void | Promise<void>;

// ─── DcaScheduler 类 ───

const POLL_INTERVAL_MS = 30_000; // 30 秒轮询
const MAX_HISTORY_PER_PLAN = 500;

export class DcaScheduler {
  private plans: DcaPlan[] = [];
  private history: Map<string, DcaExecutionRecord[]> = new Map();
  private plansPath: string;
  private historyPath: string;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private getPassword: (() => string) | null = null;
  private callbacks: DcaEventCallback[] = [];
  private exchangeManager: ExchangeManager;
  private orderExecutor: OrderExecutor;

  constructor(
    dataDir: string,
    exchangeManager: ExchangeManager,
    orderExecutor: OrderExecutor
  ) {
    this.exchangeManager = exchangeManager;
    this.orderExecutor = orderExecutor;

    const dcaDir = path.join(dataDir, 'dca');
    this.plansPath = path.join(dcaDir, 'plans.json');
    this.historyPath = path.join(dcaDir, 'history.json');

    this.loadPlans();
    this.loadHistory();
  }

  // ─── 调度器生命周期 ───

  /**
   * 启动调度器
   * @param getPassword 返回主密码的函数
   */
  start(getPassword: () => string): void {
    if (this.intervalId) return;
    this.getPassword = getPassword;

    this.intervalId = setInterval(() => {
      this.tick().catch(err =>
        console.error('[DcaScheduler] 轮询失败:', err.message)
      );
    }, POLL_INTERVAL_MS);

    // 立即执行一次
    this.tick().catch(() => {});
  }

  /**
   * 停止调度器
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

  // ─── 计划管理 ───

  /**
   * 创建定投计划
   */
  createPlan(config: {
    name: string;
    exchangeId: string;
    symbol: string;
    amountUSDT: number;
    frequency: DcaFrequency;
    executionTime: number;
  }): DcaPlan {
    if (config.amountUSDT <= 0) {
      throw new Error('定投金额必须大于 0');
    }

    // 验证 executionTime 范围
    this.validateExecutionTime(config.frequency, config.executionTime);

    const plan: DcaPlan = {
      id: crypto.randomUUID(),
      name: config.name,
      exchangeId: config.exchangeId,
      symbol: config.symbol,
      amountUSDT: config.amountUSDT,
      frequency: config.frequency,
      executionTime: config.executionTime,
      status: 'active',
      nextExecutionAt: this.calculateNextExecution(config.frequency, config.executionTime),
      createdAt: Date.now(),
      totalExecutions: 0,
      totalSpentUSDT: 0,
      totalAcquired: 0,
    };

    this.plans.push(plan);
    this.savePlans();
    return plan;
  }

  /**
   * 暂停计划
   */
  pausePlan(planId: string): boolean {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan || plan.status !== 'active') return false;
    plan.status = 'paused';
    this.savePlans();
    return true;
  }

  /**
   * 恢复计划
   */
  resumePlan(planId: string): boolean {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan || plan.status !== 'paused') return false;
    plan.status = 'active';
    plan.nextExecutionAt = this.calculateNextExecution(plan.frequency, plan.executionTime);
    this.savePlans();
    return true;
  }

  /**
   * 删除计划
   */
  removePlan(planId: string): boolean {
    const before = this.plans.length;
    this.plans = this.plans.filter(p => p.id !== planId);
    if (this.plans.length < before) {
      this.history.delete(planId);
      this.savePlans();
      this.saveHistory();
      return true;
    }
    return false;
  }

  /**
   * 列出所有计划
   */
  listPlans(): DcaPlan[] {
    return this.plans.map(p => ({ ...p }));
  }

  /**
   * 获取计划摘要（含盈亏计算）
   */
  async getPlanSummary(
    masterPassword: string,
    planId: string
  ): Promise<DcaPlanSummary | null> {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) return null;

    const avgBuyPrice = plan.totalAcquired > 0
      ? plan.totalSpentUSDT / plan.totalAcquired
      : 0;

    let currentPrice = 0;
    try {
      const ticker = await this.exchangeManager.getTicker(
        masterPassword, plan.exchangeId, plan.symbol
      );
      currentPrice = ticker.last;
    } catch { /* 无法获取价格 */ }

    const currentValue = plan.totalAcquired * currentPrice;
    const unrealizedPnL = currentValue - plan.totalSpentUSDT;
    const unrealizedPnLPercent = plan.totalSpentUSDT > 0
      ? (unrealizedPnL / plan.totalSpentUSDT) * 100
      : 0;

    const records = this.history.get(planId) ?? [];
    const recentExecutions = records.slice(-20);

    return {
      plan: { ...plan },
      avgBuyPrice,
      currentPrice,
      unrealizedPnL,
      unrealizedPnLPercent,
      recentExecutions,
    };
  }

  /**
   * 获取执行历史
   */
  getExecutionHistory(planId: string, limit: number = 50): DcaExecutionRecord[] {
    const records = this.history.get(planId) ?? [];
    return records.slice(-limit);
  }

  /**
   * 注册事件回调
   */
  onEvent(callback: DcaEventCallback): void {
    this.callbacks.push(callback);
  }

  // ─── 内部调度逻辑 ───

  private async tick(): Promise<void> {
    if (!this.getPassword) return;

    const now = Date.now();
    const activePlans = this.plans.filter(
      p => p.status === 'active' && p.nextExecutionAt <= now
    );

    for (const plan of activePlans) {
      await this.executePlan(plan);
    }
  }

  private async executePlan(plan: DcaPlan): Promise<void> {
    if (!this.getPassword) return;
    const masterPassword = this.getPassword();

    let record: DcaExecutionRecord;

    try {
      // 获取当前价格以计算买入数量
      const ticker = await this.exchangeManager.getTicker(
        masterPassword, plan.exchangeId, plan.symbol
      );
      const currentPrice = ticker.last;
      if (currentPrice <= 0) throw new Error('无效的行情价格');

      const amount = plan.amountUSDT / currentPrice;

      // 构建订单请求
      const request: OrderRequest = {
        exchange: plan.exchangeId,
        symbol: plan.symbol,
        side: 'buy',
        type: 'market',
        amount,
        market: 'spot',
      };

      // previewOrder → 获取 token → executeOrder
      const preview = await this.orderExecutor.previewOrder(masterPassword, request);

      if (preview.riskCheck.blocked) {
        record = {
          planId: plan.id,
          timestamp: Date.now(),
          status: 'failed',
          amountUSDT: plan.amountUSDT,
          price: currentPrice,
          acquired: 0,
          error: `风控拦截: ${preview.riskCheck.reasons.join('; ')}`,
        };
      } else {
        const result: OrderResult = await this.orderExecutor.executeOrder(
          masterPassword, preview.confirmationToken
        );

        if (result.success) {
          record = {
            planId: plan.id,
            timestamp: Date.now(),
            status: 'success',
            amountUSDT: result.cost || plan.amountUSDT,
            price: result.price,
            acquired: result.amount,
            orderId: result.orderId,
          };

          // 更新计划统计
          plan.totalExecutions++;
          plan.totalSpentUSDT += record.amountUSDT;
          plan.totalAcquired += record.acquired;
        } else {
          record = {
            planId: plan.id,
            timestamp: Date.now(),
            status: 'failed',
            amountUSDT: plan.amountUSDT,
            price: currentPrice,
            acquired: 0,
            error: result.error,
          };
        }
      }
    } catch (err: any) {
      record = {
        planId: plan.id,
        timestamp: Date.now(),
        status: 'failed',
        amountUSDT: plan.amountUSDT,
        price: 0,
        acquired: 0,
        error: err.message ?? String(err),
      };
    }

    // 保存执行记录
    this.addHistoryRecord(plan.id, record);

    // 计算下次执行时间
    plan.nextExecutionAt = this.calculateNextExecution(plan.frequency, plan.executionTime);
    this.savePlans();
    this.saveHistory();

    // 发送事件通知
    const eventType: DcaEventType = record.status === 'success'
      ? 'execution_success'
      : 'execution_failed';

    const coin = plan.symbol.split('/')[0];
    const message = record.status === 'success'
      ? `定投执行成功：以 $${record.price.toFixed(2)} 买入 ${record.acquired.toFixed(6)} ${coin}，花费 $${record.amountUSDT.toFixed(2)}`
      : `定投执行失败：${record.error}`;

    await this.emitEvent({
      type: eventType,
      plan: { ...plan },
      execution: record,
      message,
      timestamp: Date.now(),
    });
  }

  // ─── 时间计算 ───

  private validateExecutionTime(frequency: DcaFrequency, executionTime: number): void {
    switch (frequency) {
      case 'hourly':
        // hourly 不需要特定时间，executionTime 被忽略
        break;
      case 'daily':
        if (executionTime < 0 || executionTime > 23) {
          throw new Error('每日定投的执行时间必须为 0-23（小时）');
        }
        break;
      case 'weekly':
        if (executionTime < 0 || executionTime > 6) {
          throw new Error('每周定投的执行时间必须为 0-6（星期日=0）');
        }
        break;
      case 'monthly':
        if (executionTime < 1 || executionTime > 28) {
          throw new Error('每月定投的执行日期必须为 1-28');
        }
        break;
    }
  }

  private calculateNextExecution(frequency: DcaFrequency, executionTime: number): number {
    const now = new Date();

    switch (frequency) {
      case 'hourly': {
        // 下一个整点
        const next = new Date(now);
        next.setMinutes(0, 0, 0);
        next.setHours(next.getHours() + 1);
        return next.getTime();
      }

      case 'daily': {
        const next = new Date(now);
        next.setHours(executionTime, 0, 0, 0);
        if (next.getTime() <= now.getTime()) {
          next.setDate(next.getDate() + 1);
        }
        return next.getTime();
      }

      case 'weekly': {
        const next = new Date(now);
        next.setHours(12, 0, 0, 0); // 中午 12 点执行
        const daysUntil = (executionTime - next.getDay() + 7) % 7 || 7;
        next.setDate(next.getDate() + daysUntil);
        // 如果今天就是目标日且还没到执行时间
        if (next.getDay() === executionTime && now.getHours() < 12) {
          next.setDate(next.getDate() - 7 + daysUntil);
        }
        return next.getTime();
      }

      case 'monthly': {
        const next = new Date(now);
        next.setDate(executionTime);
        next.setHours(12, 0, 0, 0);
        if (next.getTime() <= now.getTime()) {
          next.setMonth(next.getMonth() + 1);
        }
        return next.getTime();
      }
    }
  }

  // ─── 历史记录管理 ───

  private addHistoryRecord(planId: string, record: DcaExecutionRecord): void {
    let records = this.history.get(planId);
    if (!records) {
      records = [];
      this.history.set(planId, records);
    }
    records.push(record);
    // 限制每个计划最多保留 MAX_HISTORY_PER_PLAN 条
    if (records.length > MAX_HISTORY_PER_PLAN) {
      records.splice(0, records.length - MAX_HISTORY_PER_PLAN);
    }
  }

  // ─── 事件通知 ───

  private async emitEvent(event: DcaEvent): Promise<void> {
    for (const cb of this.callbacks) {
      try {
        await cb(event);
      } catch {
        // 回调失败不影响其他回调
      }
    }
  }

  // ─── 持久化 ───

  private loadPlans(): void {
    try {
      if (fs.existsSync(this.plansPath)) {
        this.plans = JSON.parse(fs.readFileSync(this.plansPath, 'utf8'));
      }
    } catch {
      this.plans = [];
    }
  }

  private savePlans(): void {
    const dir = path.dirname(this.plansPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.plansPath, JSON.stringify(this.plans, null, 2), 'utf8');
    fs.chmodSync(this.plansPath, 0o600);
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyPath)) {
        const raw = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
        if (typeof raw === 'object' && raw !== null) {
          for (const [planId, records] of Object.entries(raw)) {
            if (Array.isArray(records)) {
              this.history.set(planId, records as DcaExecutionRecord[]);
            }
          }
        }
      }
    } catch {
      this.history = new Map();
    }
  }

  private saveHistory(): void {
    const dir = path.dirname(this.historyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj: Record<string, DcaExecutionRecord[]> = {};
    for (const [planId, records] of this.history) {
      obj[planId] = records;
    }
    fs.writeFileSync(this.historyPath, JSON.stringify(obj, null, 2), 'utf8');
    fs.chmodSync(this.historyPath, 0o600);
  }
}
