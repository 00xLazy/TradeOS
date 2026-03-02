/**
 * index.ts - CEX Trading Skill 统一入口
 *
 * 初始化所有模块并导出，供 OpenClaw Agent 调用。
 */

import path from 'node:path';
import os from 'node:os';
import { KeyVault } from './key-vault.js';
import { ExchangeManager, SUPPORTED_EXCHANGES } from './exchange-manager.js';
import { OrderExecutor } from './order-executor.js';
import { RiskGuard } from './risk-guard.js';
import { PortfolioTracker } from './portfolio-tracker.js';
import { BalanceMonitor } from './balance-monitor.js';
import { PnLTracker } from './pnl-tracker.js';

// ─── 数据目录 ───

const DATA_DIR = path.join(os.homedir(), '.openclaw', 'skills', 'cex-trading');

// ─── 初始化所有模块 ───

const vault = new KeyVault(DATA_DIR);
const exchangeManager = new ExchangeManager(vault);
const riskGuard = new RiskGuard(DATA_DIR);
const orderExecutor = new OrderExecutor(exchangeManager, riskGuard);
const portfolioTracker = new PortfolioTracker(DATA_DIR, exchangeManager);
const balanceMonitor = new BalanceMonitor(DATA_DIR, exchangeManager, portfolioTracker);
const pnlTracker = new PnLTracker(DATA_DIR, portfolioTracker);

// 注入 PnL 追踪器到订单执行器（避免循环依赖）
orderExecutor.setPnLTracker(pnlTracker);

// ─── 导出 ───

export {
  vault,
  exchangeManager,
  orderExecutor,
  riskGuard,
  portfolioTracker,
  balanceMonitor,
  pnlTracker,
  SUPPORTED_EXCHANGES,
  DATA_DIR,
};

// Re-export types
export type { ExchangeCredential } from './key-vault.js';
export type { ExchangeBalance, FormattedBalance, TickerInfo } from './exchange-manager.js';
export type { OrderRequest, OrderPreview, OrderResult } from './order-executor.js';
export type { RiskRules, RiskCheckResult } from './risk-guard.js';
export type { PortfolioSnapshot, PortfolioDiff, NetValuePoint } from './portfolio-tracker.js';
export type { AlertRule, AlertEvent, AlertType } from './balance-monitor.js';
export type { PnLReport, TradeStats } from './pnl-tracker.js';
