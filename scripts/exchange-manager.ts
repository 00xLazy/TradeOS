/**
 * exchange-manager.ts - CCXT 交易所连接管理
 *
 * 基于 CCXT 统一 API，封装多交易所连接、行情查询、余额查询等。
 */

import ccxt, { type Exchange, type Balances, type Ticker, type Market } from 'ccxt';
import { KeyVault, type ExchangeCredential } from './key-vault.js';

// ─── 支持的交易所 ───

export const SUPPORTED_EXCHANGES = [
  'binance',
  'okx',
  'bybit',
  'gateio',
  'bitget',
  'coinbase',
  'kucoin',
  'htx',
  'mexc',
  'cryptocom',
] as const;

export type SupportedExchangeId = typeof SUPPORTED_EXCHANGES[number];

// ─── 类型定义 ───

export interface FormattedBalance {
  coin: string;
  free: number;
  used: number;
  total: number;
  valueUSD: number;
}

export interface ExchangeBalance {
  exchangeId: string;
  label: string;
  balances: FormattedBalance[];
  totalUSD: number;
  timestamp: number;
}

export interface TickerInfo {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  volume: number;
  changePercent: number;
  timestamp: number;
}

// 交易所实例缓存 TTL (10 分钟)
const INSTANCE_TTL_MS = 10 * 60 * 1000;

interface CachedExchange {
  instance: Exchange;
  expiresAt: number;
}

// ─── ExchangeManager 类 ───

export class ExchangeManager {
  private vault: KeyVault;
  private instances: Map<string, CachedExchange> = new Map();

  constructor(vault: KeyVault) {
    this.vault = vault;
  }

  /**
   * 获取或创建 CCXT 交易所实例
   */
  async getExchange(
    masterPassword: string,
    exchangeId: string,
    label?: string
  ): Promise<Exchange> {
    const cacheKey = `${exchangeId}:${label ?? 'default'}`;
    const cached = this.instances.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.instance;
    }

    // 缓存过期则移除
    if (cached) {
      this.instances.delete(cacheKey);
    }

    const cred = await this.vault.getCredential(masterPassword, exchangeId, label);
    if (!cred) {
      throw new Error(`未找到交易所 ${exchangeId} 的 API Key。请先添加。`);
    }

    const exchange = this.createInstance(cred);
    await exchange.loadMarkets();
    this.instances.set(cacheKey, {
      instance: exchange,
      expiresAt: Date.now() + INSTANCE_TTL_MS,
    });
    this.cleanExpiredInstances();
    return exchange;
  }

  /**
   * 查询单个交易所余额
   */
  async getBalance(
    masterPassword: string,
    exchangeId: string,
    label?: string
  ): Promise<ExchangeBalance> {
    const exchange = await this.getExchange(masterPassword, exchangeId, label);
    const balance: Balances = await exchange.fetchBalance();

    // 获取各币种 USD 价格用于估值
    const tickers = await this.getUSDPrices(exchange, balance);

    const formatted: FormattedBalance[] = [];
    let totalUSD = 0;

    const totalBal = balance.total as unknown as Record<string, number>;
    const freeBal = balance.free as unknown as Record<string, number>;
    const usedBal = balance.used as unknown as Record<string, number>;

    for (const coin of Object.keys(totalBal)) {
      const total = totalBal[coin] ?? 0;
      if (total === 0) continue;

      const free = freeBal[coin] ?? 0;
      const used = usedBal[coin] ?? 0;
      const priceUSD = tickers[coin] ?? (coin === 'USDT' || coin === 'USDC' || coin === 'BUSD' ? 1 : 0);
      const valueUSD = total * priceUSD;

      formatted.push({ coin, free, used, total, valueUSD });
      totalUSD += valueUSD;
    }

    // 按 USD 价值降序排列
    formatted.sort((a, b) => b.valueUSD - a.valueUSD);

    return {
      exchangeId,
      label: label ?? 'default',
      balances: formatted,
      totalUSD,
      timestamp: Date.now(),
    };
  }

  /**
   * 查询所有已配置交易所的余额
   */
  async getAllBalances(masterPassword: string): Promise<{
    exchanges: ExchangeBalance[];
    totalUSD: number;
    aggregated: FormattedBalance[];
  }> {
    const credentials = await this.vault.listCredentials(masterPassword);
    const exchanges: ExchangeBalance[] = [];
    const coinMap: Map<string, FormattedBalance> = new Map();
    let totalUSD = 0;

    // 并行查询所有交易所
    const results = await Promise.allSettled(
      credentials.map(cred =>
        this.getBalance(masterPassword, cred.exchangeId, cred.label)
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const eb = result.value;
        exchanges.push(eb);
        totalUSD += eb.totalUSD;

        // 聚合各币种
        for (const b of eb.balances) {
          const existing = coinMap.get(b.coin);
          if (existing) {
            existing.free += b.free;
            existing.used += b.used;
            existing.total += b.total;
            existing.valueUSD += b.valueUSD;
          } else {
            coinMap.set(b.coin, { ...b });
          }
        }
      }
    }

    const aggregated = Array.from(coinMap.values())
      .sort((a, b) => b.valueUSD - a.valueUSD);

    return { exchanges, totalUSD, aggregated };
  }

  /**
   * 查询行情
   */
  async getTicker(
    masterPassword: string,
    exchangeId: string,
    symbol: string
  ): Promise<TickerInfo> {
    const exchange = await this.getExchange(masterPassword, exchangeId);
    const ticker: Ticker = await exchange.fetchTicker(symbol);

    return {
      symbol: ticker.symbol,
      last: ticker.last ?? 0,
      bid: ticker.bid ?? 0,
      ask: ticker.ask ?? 0,
      high: ticker.high ?? 0,
      low: ticker.low ?? 0,
      volume: ticker.baseVolume ?? 0,
      changePercent: ticker.percentage ?? 0,
      timestamp: ticker.timestamp ?? Date.now(),
    };
  }

  /**
   * 获取交易所支持的交易对列表
   */
  async getMarkets(
    masterPassword: string,
    exchangeId: string
  ): Promise<Market[]> {
    const exchange = await this.getExchange(masterPassword, exchangeId);
    return Object.values(exchange.markets);
  }

  /**
   * 获取指定交易对的交易手续费率
   * @param type 'maker' 或 'taker'
   * @returns 手续费率 (如 0.001 代表 0.1%)，如果无法获取则返回默认值
   */
  async getTradingFeeRate(
    masterPassword: string,
    exchangeId: string,
    symbol: string,
    type: 'maker' | 'taker' = 'taker'
  ): Promise<number> {
    try {
      const exchange = await this.getExchange(masterPassword, exchangeId);
      await exchange.loadMarkets(); // 确保市场信息已加载

      const market = exchange.market(symbol);
      if (market) {
        if (type === 'maker' && typeof market.maker === 'number') {
          return market.maker;
        }
        if (type === 'taker' && typeof market.taker === 'number') {
          return market.taker;
        }
      }
      // 如果市场信息中没有，尝试获取交易所全局费率（如果支持）
      if (typeof exchange.fetchTradingFees === 'function') {
        const fees = await exchange.fetchTradingFees();
        // CCXT 的 fetchTradingFees 返回格式不统一，这里做个简单尝试
        // 假设 fees.info 中有 maker/taker fee
        if (fees && (fees as any).info) {
          if (type === 'maker' && typeof (fees as any).info.makerFee === 'number') return (fees as any).info.makerFee;
          if (type === 'taker' && typeof (fees as any).info.takerFee === 'number') return (fees as any).info.takerFee;
        }
        // 尝试从 fees 对象本身获取
        if (type === 'maker' && typeof fees.maker === 'number') return fees.maker;
        if (type === 'taker' && typeof fees.taker === 'number') return fees.taker;
      }
    } catch (err: any) {
      console.warn(`[ExchangeManager] 无法获取 ${exchangeId} ${symbol} 的 ${type} 手续费率，使用默认值 0.001:`, err.message);
    }
    // 默认值：0.1%
    return 0.001;
  }

  /**
   * 检测 API Key 权限（通过实际 API 调用验证）
   */
  async detectPermissions(
    masterPassword: string,
    exchangeId: string,
    label?: string
  ): Promise<{ permissions: string[]; hasWithdraw: boolean }> {
    const exchange = await this.getExchange(masterPassword, exchangeId, label);
    const permissions: string[] = [];
    let hasWithdraw = false;

    // 尝试读取余额 → 说明有读权限
    try {
      await exchange.fetchBalance();
      permissions.push('read');
    } catch (err: any) {
      console.debug(`[ExchangeManager] ${exchange.id} 不具备读取余额权限:`, err.message);
    }

    // 尝试查看挂单 → 说明有交易读权限
    try {
      await exchange.fetchOpenOrders();
      permissions.push('spot');
    } catch (err: any) {
      console.debug(`[ExchangeManager] ${exchange.id} 不具备现货交易权限:`, err.message);
    }

    // 检测提现权限：通过交易所 API 返回的权限信息
    try {
      if (typeof (exchange as any).fetchApiPermissions === 'function') {
        const apiPerms = await (exchange as any).fetchApiPermissions();
        if (apiPerms) {
          // Binance 风格：enableWithdrawals
          if (apiPerms.enableWithdrawals || apiPerms.withdraw || apiPerms.enableInternalTransfer) {
            hasWithdraw = true;
          }
          // 通用检测：遍历权限对象查找 withdraw 相关字段
          const permStr = JSON.stringify(apiPerms).toLowerCase();
          if (permStr.includes('"withdraw":true') || permStr.includes('"enablewithdrawals":true')) {
            hasWithdraw = true;
          }
        }
      }
    } catch (err: any) {
      console.debug(`[ExchangeManager] ${exchange.id} 不支持 fetchApiPermissions 或权限检测失败:`, err.message);
    }

    // 备用检测：尝试调用获取充提历史（如果成功则可能有提现权限）
    if (!hasWithdraw) {
      try {
        if (typeof exchange.fetchWithdrawals === 'function') {
          await exchange.fetchWithdrawals(undefined, undefined, 1);
          // 如果能成功获取提现历史，说明至少有读取提现记录的权限
          hasWithdraw = true;
        }
      } catch (err: any) {
        console.debug(`[ExchangeManager] ${exchange.id} 不具备读取提现记录权限或不支持 fetchWithdrawals:`, err.message);
        // 无权限或交易所不支持，视为安全
      }
    }

    return { permissions, hasWithdraw };
  }

  /**
   * 列出所有已配置的交易所
   */
  async listConfiguredExchanges(masterPassword: string): Promise<
    { exchangeId: string; label: string; id: string }[]
  > {
    const credentials = await this.vault.listCredentials(masterPassword);
    return credentials.map(c => ({
      exchangeId: c.exchangeId,
      label: c.label,
      id: c.id,
    }));
  }

  /**
   * 清理连接缓存
   */
  clearCache(): void {
    this.instances.clear();
  }

  // ─── 内部方法 ───

  private cleanExpiredInstances(): void {
    const now = Date.now();
    for (const [key, cached] of this.instances) {
      if (now > cached.expiresAt) {
        this.instances.delete(key);
      }
    }
  }

  private createInstance(cred: ExchangeCredential): Exchange {
    // 白名单校验：防止通过原型链属性访问等攻击
    if (!SUPPORTED_EXCHANGES.includes(cred.exchangeId as SupportedExchangeId)) {
      throw new Error(
        `不支持的交易所: ${cred.exchangeId}。支持的交易所: ${SUPPORTED_EXCHANGES.join(', ')}`
      );
    }

    const ExchangeClass = (ccxt as any)[cred.exchangeId];
    if (!ExchangeClass) {
      throw new Error(`不支持的交易所: ${cred.exchangeId}`);
    }

    const config: any = {
      apiKey: cred.apiKey,
      secret: cred.secret,
      enableRateLimit: true,
      timeout: 30_000,
    };

    if (cred.passphrase) {
      config.password = cred.passphrase;
    }

    return new ExchangeClass(config);
  }

  /**
   * 获取持仓币种的 USD 价格
   */
  private async getUSDPrices(
    exchange: Exchange,
    balance: Balances
  ): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    const stablecoins = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD']);

    const totalBal2 = balance.total as unknown as Record<string, number>;
    const coins = Object.keys(totalBal2).filter(
      coin => (totalBal2[coin] ?? 0) > 0 && !stablecoins.has(coin)
    );

    // 批量获取行情
    const symbols = coins
      .map(coin => `${coin}/USDT`)
      .filter(sym => exchange.markets[sym]);

    if (symbols.length > 0) {
      try {
        const tickers = await exchange.fetchTickers(symbols);
        for (const [sym, ticker] of Object.entries(tickers)) {
          const coin = sym.split('/')[0];
          if (ticker.last) {
            prices[coin] = ticker.last;
          }
        }
      } catch (err: any) {
        console.warn(`[ExchangeManager] 从 ${exchange.id} 批量获取行情失败，尝试逐个获取:`, err.message);
        // 如果批量获取失败，逐个获取
        for (const sym of symbols) {
          try {
            const ticker = await exchange.fetchTicker(sym);
            const coin = sym.split('/')[0];
            if (ticker.last) prices[coin] = ticker.last;
          } catch (individualErr: any) {
            console.warn(`[ExchangeManager] 从 ${exchange.id} 获取 ${sym} 行情失败，跳过:`, individualErr.message);
          }
        }
      }
    }

    return prices;
  }
}
