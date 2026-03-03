/**
 * conditional-order.ts - 条件单/计划委托
 *
 * 当市场价格满足预设条件时自动触发下单。
 * 支持一次性触发和持续触发两种模式。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ExchangeManager } from './exchange-manager.js';
import { OrderExecutor, type OrderRequest, type OrderResult } from './order-executor.js';
import { sanitizeErrorMessage } from './security-utils.js';

// ─── 类型定义 ───

export type ConditionType = 'price_above' | 'price_below' | 'price_change_up' | 'price_change_down';
export type TriggerMode = 'once' | 'recurring';
export type ConditionalOrderStatus = 'active' | 'paused' | 'triggered' | 'expired';

export interface ConditionalOrder {
  id: string;
  name: string;
  exchangeId: string;
  credentialLabel?: string;   // 多账户场景下指定凭证 label
  symbol: string;
  condition: {
    type: ConditionType;
    targetPrice?: number;
    changePercent?: number;
    basePrice?: number;
  };
  order: {
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    amount: number;
    price?: number;
    market: 'spot' | 'futures';
    leverage?: number;
  };
  triggerMode: TriggerMode;
  cooldownMs: number;
  lastTriggeredAt: number;
  status: ConditionalOrderStatus;
  expiresAt?: number;
  createdAt: number;
  totalTriggers: number;
}

export interface ConditionalOrderExecution {
  orderId: string;
  timestamp: number;
  status: 'success' | 'failed';
  price: number;
  orderResult?: OrderResult;
  error?: string;
}

export type ConditionalOrderEventType = 'triggered_success' | 'triggered_failed' | 'expired';

export interface ConditionalOrderEvent {
  type: ConditionalOrderEventType;
  order: ConditionalOrder;
  execution?: ConditionalOrderExecution;
  message: string;
  timestamp: number;
}

type ConditionalOrderEventCallback = (event: ConditionalOrderEvent) => void | Promise<void>;
type ConditionalOrderApprovalHandler = (context: {
  order: ConditionalOrder;
  request: OrderRequest;
}) => boolean | Promise<boolean>;

// ─── 常量 ───

const POLL_INTERVAL_MS = 15_000; // 15 秒（价格敏感）
const MAX_HISTORY_PER_ORDER = 200;

// ─── ConditionalOrderManager 类 ───

export class ConditionalOrderManager {
  private orders: ConditionalOrder[] = [];
  private history: Map<string, ConditionalOrderExecution[]> = new Map();
  private ordersPath: string;
  private historyPath: string;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private getPassword: (() => string) | null = null;
  private callbacks: ConditionalOrderEventCallback[] = [];
  private exchangeManager: ExchangeManager;
  private orderExecutor: OrderExecutor;
  private requireManualApproval: boolean = true;
  private approvalHandler: ConditionalOrderApprovalHandler | null = null;

  constructor(
    dataDir: string,
    exchangeManager: ExchangeManager,
    orderExecutor: OrderExecutor
  ) {
    this.exchangeManager = exchangeManager;
    this.orderExecutor = orderExecutor;

    const dir = path.join(dataDir, 'conditional-orders');
    this.ordersPath = path.join(dir, 'orders.json');
    this.historyPath = path.join(dir, 'history.json');

    this.loadOrders();
    this.loadHistory();
  }

  // ─── 生命周期 ───

  start(getPassword: () => string): void {
    if (this.timeoutId) return;
    this.getPassword = getPassword;

    const _poll = async () => {
      try {
        await this.tick();
      } catch (err: any) {
        console.error('[ConditionalOrder] 轮询失败:', err.message);
      } finally {
        if (this.timeoutId !== null) {
          this.timeoutId = setTimeout(_poll, POLL_INTERVAL_MS);
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

  /**
   * 设置自动交易审批回调（建议由 Human-in-the-Loop 实现）
   */
  setApprovalHandler(handler: ConditionalOrderApprovalHandler | null): void {
    this.approvalHandler = handler;
  }

  /**
   * 是否强制每次自动触发都经过人工审批
   */
  setRequireManualApproval(required: boolean): void {
    this.requireManualApproval = required;
  }

  // ─── 条件单管理 ───

  createOrder(config: {
    name: string;
    exchangeId: string;
    credentialLabel?: string;
    symbol: string;
    condition: {
      type: ConditionType;
      targetPrice?: number;
      changePercent?: number;
      basePrice?: number;
    };
    order: {
      side: 'buy' | 'sell';
      type: 'market' | 'limit';
      amount: number;
      price?: number;
      market: 'spot' | 'futures';
      leverage?: number;
    };
    triggerMode?: TriggerMode;
    cooldownMs?: number;
    expiresAt?: number;
  }): ConditionalOrder {
    if (config.order.amount <= 0) {
      throw new Error('订单数量必须大于 0');
    }

    const condType = config.condition.type;
    if ((condType === 'price_above' || condType === 'price_below') && !config.condition.targetPrice) {
      throw new Error('价格条件必须指定 targetPrice');
    }
    if ((condType === 'price_change_up' || condType === 'price_change_down') && !config.condition.changePercent) {
      throw new Error('价格变动条件必须指定 changePercent');
    }

    const order: ConditionalOrder = {
      id: crypto.randomUUID(),
      name: config.name,
      exchangeId: config.exchangeId,
      credentialLabel: config.credentialLabel,
      symbol: config.symbol,
      condition: { ...config.condition },
      order: { ...config.order },
      triggerMode: config.triggerMode ?? 'once',
      cooldownMs: config.cooldownMs ?? 60_000,
      lastTriggeredAt: 0,
      status: 'active',
      expiresAt: config.expiresAt,
      createdAt: Date.now(),
      totalTriggers: 0,
    };

    this.orders.push(order);
    this.saveOrders();
    return order;
  }

  cancelOrder(orderId: string): boolean {
    const before = this.orders.length;
    this.orders = this.orders.filter(o => o.id !== orderId);
    if (this.orders.length < before) {
      this.history.delete(orderId);
      this.saveOrders();
      this.saveHistory();
      return true;
    }
    return false;
  }

  pauseOrder(orderId: string): boolean {
    const order = this.orders.find(o => o.id === orderId);
    if (!order || order.status !== 'active') return false;
    order.status = 'paused';
    this.saveOrders();
    return true;
  }

  resumeOrder(orderId: string): boolean {
    const order = this.orders.find(o => o.id === orderId);
    if (!order || order.status !== 'paused') return false;
    order.status = 'active';
    this.saveOrders();
    return true;
  }

  listOrders(): ConditionalOrder[] {
    return this.orders.map(o => ({ ...o }));
  }

  getExecutionHistory(orderId?: string, limit: number = 50): ConditionalOrderExecution[] {
    if (orderId) {
      const records = this.history.get(orderId) ?? [];
      return records.slice(-limit);
    }
    // 所有条件单的历史汇总
    const all: ConditionalOrderExecution[] = [];
    for (const records of this.history.values()) {
      all.push(...records);
    }
    all.sort((a, b) => b.timestamp - a.timestamp);
    return all.slice(0, limit);
  }

  onEvent(callback: ConditionalOrderEventCallback): void {
    this.callbacks.push(callback);
  }

  // ─── 内部调度逻辑 ───

  private async tick(): Promise<void> {
    if (!this.getPassword) return;
    const masterPassword = this.getPassword();

    const activeOrders = this.orders.filter(o => o.status === 'active');
    let dirty = false;

    for (const order of activeOrders) {
      // 过期检查
      if (order.expiresAt && Date.now() > order.expiresAt) {
        order.status = 'expired';
        dirty = true;
        await this.emitEvent({
          type: 'expired',
          order: { ...order },
          message: `条件单"${order.name}"已过期`,
          timestamp: Date.now(),
        });
        continue;
      }

      // recurring 冷却期检查
      if (order.triggerMode === 'recurring' && order.lastTriggeredAt > 0) {
        if (Date.now() - order.lastTriggeredAt < order.cooldownMs) continue;
      }

      // 获取当前价格
      let currentPrice: number;
      try {
        const ticker = await this.exchangeManager.getTicker(
          masterPassword, order.exchangeId, order.symbol, order.credentialLabel
        );
        currentPrice = ticker.last;
        if (currentPrice <= 0) continue;
      } catch {
        continue; // 获取价格失败，跳过本轮
      }

      // 检查条件是否满足
      if (!this.checkCondition(order, currentPrice)) continue;

      // 条件满足，执行订单
      await this.executeConditionalOrder(masterPassword, order, currentPrice);
      dirty = true;
    }

    if (dirty) {
      this.saveOrders();
      this.saveHistory();
    }
  }

  private checkCondition(order: ConditionalOrder, currentPrice: number): boolean {
    const { type, targetPrice, changePercent, basePrice } = order.condition;

    switch (type) {
      case 'price_above':
        return targetPrice !== undefined && currentPrice >= targetPrice;

      case 'price_below':
        return targetPrice !== undefined && currentPrice <= targetPrice;

      case 'price_change_up':
        if (!changePercent || !basePrice) return false;
        return currentPrice >= basePrice * (1 + changePercent / 100);

      case 'price_change_down':
        if (!changePercent || !basePrice) return false;
        return currentPrice <= basePrice * (1 - changePercent / 100);

      default:
        return false;
    }
  }

  private async executeConditionalOrder(
    masterPassword: string,
    order: ConditionalOrder,
    triggerPrice: number
  ): Promise<void> {
    let execution: ConditionalOrderExecution;

    try {
      const request: OrderRequest = {
        exchange: order.exchangeId,
        accountLabel: order.credentialLabel,
        symbol: order.symbol,
        side: order.order.side,
        type: order.order.type,
        amount: order.order.amount,
        price: order.order.price,
        market: order.order.market,
        leverage: order.order.leverage,
      };

      const approval = await this.requestExecutionApproval(order, request);
      if (!approval.approved) {
        if (approval.pauseOrder) {
          order.status = 'paused';
        }
        execution = {
          orderId: order.id,
          timestamp: Date.now(),
          status: 'failed',
          price: triggerPrice,
          error: approval.reason,
        };
      } else {
        const preview = await this.orderExecutor.previewOrder(masterPassword, request);

        if (preview.riskCheck.blocked) {
          execution = {
            orderId: order.id,
            timestamp: Date.now(),
            status: 'failed',
            price: triggerPrice,
            error: `风控拦截: ${preview.riskCheck.reasons.join('; ')}`,
          };
        } else {
          const result = await this.orderExecutor.executeOrder(
            masterPassword, preview.confirmationToken
          );

          if (result.success) {
            execution = {
              orderId: order.id,
              timestamp: Date.now(),
              status: 'success',
              price: triggerPrice,
              orderResult: result,
            };
          } else {
            execution = {
              orderId: order.id,
              timestamp: Date.now(),
              status: 'failed',
              price: triggerPrice,
              error: result.error,
            };
          }
        }
      }
    } catch (err: any) {
      execution = {
        orderId: order.id,
        timestamp: Date.now(),
        status: 'failed',
        price: triggerPrice,
        error: sanitizeErrorMessage(err),
      };
    }

    // 更新条件单状态
    order.totalTriggers++;
    order.lastTriggeredAt = Date.now();
    if (order.triggerMode === 'once' && execution.status === 'success') {
      order.status = 'triggered';
    }

    // 记录执行历史
    this.addHistoryRecord(order.id, execution);

    // 发送事件
    const eventType: ConditionalOrderEventType = execution.status === 'success'
      ? 'triggered_success'
      : 'triggered_failed';

    const coin = order.symbol.split('/')[0];
    const message = execution.status === 'success'
      ? `条件单"${order.name}"触发成功：${coin} 价格达到 $${triggerPrice.toFixed(2)}，已${order.order.side === 'buy' ? '买入' : '卖出'} ${order.order.amount} ${coin}`
      : `条件单"${order.name}"触发失败：${execution.error}`;

    await this.emitEvent({
      type: eventType,
      order: { ...order },
      execution,
      message,
      timestamp: Date.now(),
    });
  }

  private async requestExecutionApproval(
    order: ConditionalOrder,
    request: OrderRequest
  ): Promise<{ approved: boolean; reason?: string; pauseOrder?: boolean }> {
    if (!this.requireManualApproval) {
      return { approved: true };
    }

    if (!this.approvalHandler) {
      return {
        approved: false,
        pauseOrder: true,
        reason: '未配置人工审批回调，已自动暂停该条件单。',
      };
    }

    try {
      const approved = await this.approvalHandler({
        order: { ...order },
        request: { ...request },
      });
      if (!approved) {
        return { approved: false, reason: '本次条件单触发未通过人工审批。' };
      }
      return { approved: true };
    } catch (err: any) {
      return {
        approved: false,
        reason: `人工审批流程异常：${sanitizeErrorMessage(err)}`,
      };
    }
  }

  // ─── 历史记录 ───

  private addHistoryRecord(orderId: string, record: ConditionalOrderExecution): void {
    let records = this.history.get(orderId);
    if (!records) {
      records = [];
      this.history.set(orderId, records);
    }
    records.push(record);
    if (records.length > MAX_HISTORY_PER_ORDER) {
      records.splice(0, records.length - MAX_HISTORY_PER_ORDER);
    }
  }

  // ─── 事件通知 ───

  private async emitEvent(event: ConditionalOrderEvent): Promise<void> {
    for (const cb of this.callbacks) {
      try {
        await cb(event);
      } catch (err: any) {
        console.error(`[ConditionalOrder] 事件回调失败:`, err.message);
      }
    }
  }

  // ─── 持久化 ───

  private loadOrders(): void {
    try {
      if (fs.existsSync(this.ordersPath)) {
        this.orders = JSON.parse(fs.readFileSync(this.ordersPath, 'utf8'));
      }
    } catch (err: any) {
      console.error('[ConditionalOrder] 加载条件单失败:', err.message);
      this.orders = [];
    }
  }

  private saveOrders(): void {
    const dir = path.dirname(this.ordersPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.ordersPath, JSON.stringify(this.orders, null, 2), 'utf8');
    fs.chmodSync(this.ordersPath, 0o600);
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyPath)) {
        const raw = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
        if (typeof raw === 'object' && raw !== null) {
          for (const [orderId, records] of Object.entries(raw)) {
            if (Array.isArray(records)) {
              this.history.set(orderId, records as ConditionalOrderExecution[]);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('[ConditionalOrder] 加载执行历史失败:', err.message);
      this.history = new Map();
    }
  }

  private saveHistory(): void {
    const dir = path.dirname(this.historyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj: Record<string, ConditionalOrderExecution[]> = {};
    for (const [orderId, records] of this.history) {
      obj[orderId] = records;
    }
    fs.writeFileSync(this.historyPath, JSON.stringify(obj, null, 2), 'utf8');
    fs.chmodSync(this.historyPath, 0o600);
  }
}
