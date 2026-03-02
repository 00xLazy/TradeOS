/**
 * order-executor.ts - 订单执行引擎
 *
 * 支持市价单、限价单、止损单等多种订单类型，
 * 所有交易必须经过风控检查和用户二次确认。
 */

import type { Exchange, Order } from 'ccxt';
import { ExchangeManager, type TickerInfo } from './exchange-manager.js';
import { RiskGuard, type RiskCheckResult } from './risk-guard.js';
import type { PnLTracker } from './pnl-tracker.js';

// ─── 类型定义 ───

export type OrderType = 'market' | 'limit' | 'stop-loss' | 'take-profit';
export type OrderSide = 'buy' | 'sell';
export type MarketType = 'spot' | 'futures';

export interface OrderRequest {
  exchange: string;
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

export class OrderExecutor {
  private exchangeManager: ExchangeManager;
  private riskGuard: RiskGuard;
  private pnlTracker: PnLTracker | null = null;

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
    const ticker = await this.exchangeManager.getTicker(
      masterPassword, request.exchange, request.symbol
    );

    const currentPrice = ticker.last;
    const price = request.type === 'market' ? currentPrice : (request.price ?? currentPrice);
    const estimatedValue = request.amount * price;
    const estimatedFee = estimatedValue * 0.001; // 默认 0.1% 手续费估算

    // 风控检查
    const riskCheck = this.riskGuard.checkOrder(request, estimatedValue);

    const warnings: string[] = [...riskCheck.warnings];
    if (request.market === 'futures' && request.leverage && request.leverage > 10) {
      warnings.push(`高杠杆警告：${request.leverage}x 杠杆交易风险极高，请确认你了解爆仓风险。`);
    }
    if (request.type === 'market' && estimatedValue > 10_000) {
      warnings.push(`大额市价单警告：预估金额 $${estimatedValue.toFixed(2)}，市价单可能产生较大滑点。`);
    }

    return {
      request,
      currentPrice,
      estimatedValue,
      estimatedFee,
      riskCheck,
      warnings,
    };
  }

  /**
   * 执行订单（需在 previewOrder 后、用户确认后调用）
   */
  async executeOrder(
    masterPassword: string,
    request: OrderRequest
  ): Promise<OrderResult> {
    // 再次进行风控检查
    const ticker = await this.exchangeManager.getTicker(
      masterPassword, request.exchange, request.symbol
    );
    const estimatedCost = request.amount * (request.price ?? ticker.last);
    const riskCheck = this.riskGuard.checkOrder(request, estimatedCost);

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
      masterPassword, request.exchange
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
        error: err.message ?? String(err),
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
    symbol: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const exchange = await this.exchangeManager.getExchange(masterPassword, exchangeId);
      await exchange.cancelOrder(orderId, symbol);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err) };
    }
  }

  /**
   * 查询挂单列表
   */
  async getOpenOrders(
    masterPassword: string,
    exchangeId: string,
    symbol?: string
  ): Promise<Order[]> {
    const exchange = await this.exchangeManager.getExchange(masterPassword, exchangeId);
    return exchange.fetchOpenOrders(symbol);
  }

  /**
   * 查询历史订单
   */
  async getOrderHistory(
    masterPassword: string,
    exchangeId: string,
    symbol?: string,
    limit: number = 20
  ): Promise<Order[]> {
    const exchange = await this.exchangeManager.getExchange(masterPassword, exchangeId);
    return exchange.fetchClosedOrders(symbol, undefined, limit);
  }

  // ─── 内部方法 ───

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
}
