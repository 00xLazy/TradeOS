/**
 * order-executor.ts - 订单执行引擎
 *
 * 支持市价单、限价单、止损单等多种订单类型，
 * 所有交易必须经过风控检查和用户二次确认。
 */

import crypto from 'node:crypto';
import type { Exchange, Order } from 'ccxt';
import { ExchangeManager, type TickerInfo } from './exchange-manager.js';
import { RiskGuard, type RiskCheckResult } from './risk-guard.js';
import type { PnLTracker } from './pnl-tracker.js';
import { sanitizeErrorMessage } from './security-utils.js';

// ─── 类型定义 ───

export type OrderType = 'market' | 'limit' | 'stop-loss' | 'take-profit';
export type OrderSide = 'buy' | 'sell';
export type MarketType = 'spot' | 'futures';

export interface OrderRequest {
  exchange: string;
  accountLabel?: string;   // 多账户场景下指定凭证 label
  symbol: string;         // 如 'BTC/USDT'
  side: OrderSide;
  type: OrderType;
  amount: number;
  price?: number;         // 限价单价格
  stopPrice?: number;     // 止损/止盈触发价
  market: MarketType;
  leverage?: number;      // 合约杠杆倍数
}

export interface OrderPreview {
  request: OrderRequest;
  currentPrice: number;
  estimatedValue: number;    // 预估金额：买入为花费，卖出为收入 (USDT)
  estimatedFee: number;      // 预估手续费
  riskCheck: RiskCheckResult;
  warnings: string[];
  confirmationToken: string; // 一次性确认 token，执行时必须传入
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price: number;             // 实际成交价
  cost: number;              // 实际花费
  fee: number;
  status: string;
  timestamp: number;
  raw?: Order;
  error?: string;
}

// ─── OrderExecutor 类 ───

// 确认 token 有效期 (5 分钟)
const TOKEN_TTL_MS = 5 * 60 * 1000;

interface PendingConfirmation {
  token: string;
  request: OrderRequest;
  expiresAt: number;
}

export class OrderExecutor {
  private exchangeManager: ExchangeManager;
  private riskGuard: RiskGuard;
  private pnlTracker: PnLTracker | null = null;
  private pendingConfirmations: Map<string, PendingConfirmation> = new Map();

  constructor(exchangeManager: ExchangeManager, riskGuard: RiskGuard) {
    this.exchangeManager = exchangeManager;
    this.riskGuard = riskGuard;
  }

  /**
   * 设置 PnL 追踪器（避免循环依赖，通过 setter 注入）
   */
  setPnLTracker(tracker: PnLTracker): void {
    this.pnlTracker = tracker;
  }

  /**
   * 预览订单（不执行）——生成确认信息给用户
   */
  async previewOrder(
    masterPassword: string,
    request: OrderRequest
  ): Promise<OrderPreview> {
    this.validateOrderRequest(request);

    const ticker = await this.exchangeManager.getTicker(
      masterPassword, request.exchange, request.symbol, request.accountLabel
    );

    const currentPrice = ticker.last;
    const price = this.getEstimatedExecutionPrice(request, ticker);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('无法获取有效成交价格，请稍后重试或改用限价单。');
    }

    const estimatedValue = request.amount * price;
    const feeRate = await this.exchangeManager.getTradingFeeRate(
      masterPassword,
      request.exchange,
      request.symbol,
      'taker',
      request.accountLabel
    );
    const estimatedFee = estimatedValue * feeRate;

    // 风控检查
    const riskCheck = this.riskGuard.checkOrder(request, estimatedValue, currentPrice);

    const warnings: string[] = [...riskCheck.warnings];
    if (request.market === 'futures' && request.leverage && request.leverage > 10) {
      warnings.push(`高杠杆警告：${request.leverage}x 杠杆交易风险极高，请确认你了解爆仓风险。`);
    }
    if (request.type === 'market' && estimatedValue > 10_000) {
      warnings.push(`大额市价单警告：预估金额 $${estimatedValue.toFixed(2)}，市价单可能产生较大滑点。`);
    }

    // 生成一次性确认 token
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    this.pendingConfirmations.set(confirmationToken, {
      token: confirmationToken,
      request,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    this.cleanExpiredTokens();

    return {
      request,
      currentPrice,
      estimatedValue,
      estimatedFee,
      riskCheck,
      warnings,
      confirmationToken,
    };
  }

  /**
   * 执行订单（需在 previewOrder 后、用户确认后调用）
   * @param confirmationToken previewOrder 返回的一次性确认 token
   */
  async executeOrder(
    masterPassword: string,
    confirmationToken: string
  ): Promise<OrderResult> {
    // 验证确认 token
    const pending = this.pendingConfirmations.get(confirmationToken);
    if (!pending) {
      return {
        success: false,
        symbol: '',
        side: 'buy',
        type: 'market',
        amount: 0,
        price: 0,
        cost: 0,
        fee: 0,
        status: 'rejected',
        timestamp: Date.now(),
        error: '无效的确认 token。请先调用 previewOrder 获取订单预览。',
      };
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingConfirmations.delete(confirmationToken);
      return {
        success: false,
        symbol: pending.request.symbol,
        side: pending.request.side,
        type: pending.request.type,
        amount: pending.request.amount,
        price: 0,
        cost: 0,
        fee: 0,
        status: 'rejected',
        timestamp: Date.now(),
        error: '确认 token 已过期（5 分钟），请重新预览订单。',
      };
    }

    // 消费 token（一次性）
    this.pendingConfirmations.delete(confirmationToken);
    const request = pending.request;

    // 再次进行风控检查
    const ticker = await this.exchangeManager.getTicker(
      masterPassword, request.exchange, request.symbol, request.accountLabel
    );
    const estimatedCost = request.amount * this.getEstimatedExecutionPrice(request, ticker);
    const riskCheck = this.riskGuard.checkOrder(request, estimatedCost, ticker.last);

    if (riskCheck.blocked) {
      return {
        success: false,
        symbol: request.symbol,
        side: request.side,
        type: request.type,
        amount: request.amount,
        price: 0,
        cost: 0,
        fee: 0,
        status: 'rejected',
        timestamp: Date.now(),
        error: `风控拦截: ${riskCheck.reasons.join('; ')}`,
      };
    }

    const exchange = await this.exchangeManager.getExchange(
      masterPassword, request.exchange, request.accountLabel
    );

    try {
      // 合约设置杠杆
      if (request.market === 'futures' && request.leverage) {
        await this.setLeverage(exchange, request.symbol, request.leverage);
      }

      let order: Order;

      switch (request.type) {
        case 'market':
          order = await exchange.createOrder(
            request.symbol,
            'market',
            request.side,
            request.amount
          );
          break;

        case 'limit':
          if (!request.price) throw new Error('限价单必须指定价格');
          order = await exchange.createOrder(
            request.symbol,
            'limit',
            request.side,
            request.amount,
            request.price
          );
          break;

        case 'stop-loss':
          if (!request.stopPrice) throw new Error('止损单必须指定触发价格');
          order = await exchange.createOrder(
            request.symbol,
            'market',
            request.side,
            request.amount,
            undefined,
            { stopPrice: request.stopPrice, type: 'stop' }
          );
          break;

        case 'take-profit':
          if (!request.stopPrice) throw new Error('止盈单必须指定触发价格');
          order = await exchange.createOrder(
            request.symbol,
            'market',
            request.side,
            request.amount,
            undefined,
            { stopPrice: request.stopPrice, type: 'takeProfit' }
          );
          break;

        default:
          throw new Error(`不支持的订单类型: ${request.type}`);
      }

      // 记录到风控模块的日交易量
      const actualCost = order.cost ?? estimatedCost;
      this.riskGuard.recordTrade(actualCost, request.symbol);

      // 记录到 PnL 追踪器
      if (this.pnlTracker) {
        this.pnlTracker.recordTrade({
          timestamp: order.timestamp ?? Date.now(),
          exchange: request.exchange,
          symbol: order.symbol,
          side: request.side,
          amount: order.filled ?? request.amount,
          price: order.average ?? order.price ?? 0,
          cost: order.cost ?? 0,
          fee: order.fee?.cost ?? 0,
        });
      }

      return {
        success: true,
        orderId: order.id,
        symbol: order.symbol,
        side: request.side,
        type: request.type,
        amount: order.filled ?? request.amount,
        price: order.average ?? order.price ?? 0,
        cost: order.cost ?? 0,
        fee: order.fee?.cost ?? 0,
        status: order.status ?? 'unknown',
        timestamp: order.timestamp ?? Date.now(),
        raw: order,
      };
    } catch (err: any) {
      return {
        success: false,
        symbol: request.symbol,
        side: request.side,
        type: request.type,
        amount: request.amount,
        price: 0,
        cost: 0,
        fee: 0,
        status: 'error',
        timestamp: Date.now(),
        error: OrderExecutor.sanitizeError(err),
      };
    }
  }

  /**
   * 取消挂单
   */
  async cancelOrder(
    masterPassword: string,
    exchangeId: string,
    orderId: string,
    symbol: string,
    accountLabel?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const exchange = await this.exchangeManager.getExchange(masterPassword, exchangeId, accountLabel);
      await exchange.cancelOrder(orderId, symbol);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: OrderExecutor.sanitizeError(err) };
    }
  }

  /**
   * 查询挂单列表
   */
  async getOpenOrders(
    masterPassword: string,
    exchangeId: string,
    symbol?: string,
    accountLabel?: string
  ): Promise<Order[]> {
    const exchange = await this.exchangeManager.getExchange(masterPassword, exchangeId, accountLabel);
    return exchange.fetchOpenOrders(symbol);
  }

  /**
   * 查询历史订单
   */
  async getOrderHistory(
    masterPassword: string,
    exchangeId: string,
    symbol?: string,
    limit: number = 20,
    accountLabel?: string
  ): Promise<Order[]> {
    const exchange = await this.exchangeManager.getExchange(masterPassword, exchangeId, accountLabel);
    return exchange.fetchClosedOrders(symbol, undefined, limit);
  }

  // ─── 内部方法 ───

  private cleanExpiredTokens(): void {
    const now = Date.now();
    for (const [token, pending] of this.pendingConfirmations) {
      if (now > pending.expiresAt) {
        this.pendingConfirmations.delete(token);
      }
    }
  }

  /**
   * 过滤错误信息中的敏感内容（API Key、Secret、签名等）
   */
  static sanitizeError(err: any): string {
    return sanitizeErrorMessage(err);
  }

  /**
   * 估算下单可成交价格：
   * - 市价买单优先使用 ask
   * - 市价卖单优先使用 bid
   * - 其他场景回退到用户限价或 last
   */
  private getEstimatedExecutionPrice(request: OrderRequest, ticker: TickerInfo): number {
    if (request.type === 'market') {
      if (request.side === 'buy' && ticker.ask > 0) return ticker.ask;
      if (request.side === 'sell' && ticker.bid > 0) return ticker.bid;
    }
    if (request.price && request.price > 0) return request.price;
    if (ticker.last > 0) return ticker.last;
    if (request.side === 'buy' && ticker.ask > 0) return ticker.ask;
    if (request.side === 'sell' && ticker.bid > 0) return ticker.bid;
    return 0;
  }

  private async setLeverage(
    exchange: Exchange,
    symbol: string,
    leverage: number
  ): Promise<void> {
    try {
      if (typeof exchange.setLeverage === 'function') {
        await exchange.setLeverage(leverage, symbol);
      }
    } catch {
      // 部分交易所不支持动态设置杠杆，忽略
    }
  }

  private validateOrderRequest(request: OrderRequest): void {
    if (!request.exchange || !request.exchange.trim()) {
      throw new Error('exchange 不能为空。');
    }
    if (!request.symbol || !request.symbol.includes('/')) {
      throw new Error('symbol 格式无效，应类似 BTC/USDT。');
    }
    if (!Number.isFinite(request.amount) || request.amount <= 0) {
      throw new Error('订单数量 amount 必须为大于 0 的有限数字。');
    }

    if (request.price !== undefined && (!Number.isFinite(request.price) || request.price <= 0)) {
      throw new Error('价格 price 必须为大于 0 的有限数字。');
    }
    if (request.stopPrice !== undefined && (!Number.isFinite(request.stopPrice) || request.stopPrice <= 0)) {
      throw new Error('触发价 stopPrice 必须为大于 0 的有限数字。');
    }

    if (request.type === 'limit' && request.price === undefined) {
      throw new Error('限价单必须提供 price。');
    }
    if ((request.type === 'stop-loss' || request.type === 'take-profit') && request.stopPrice === undefined) {
      throw new Error('止损/止盈单必须提供 stopPrice。');
    }

    if (request.leverage !== undefined) {
      if (request.market !== 'futures') {
        throw new Error('仅 futures 订单允许设置 leverage。');
      }
      if (!Number.isFinite(request.leverage) || request.leverage <= 0 || request.leverage > 125) {
        throw new Error('leverage 必须是 1-125 的有限数字。');
      }
    }
  }
}
