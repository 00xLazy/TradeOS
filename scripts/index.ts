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
import { DcaScheduler } from './dca-scheduler.js';
import { ArbitrageScanner } from './arbitrage-scanner.js';
import { FundingRateMonitor } from './funding-rate-monitor.js';
import { ConditionalOrderManager } from './conditional-order.js';
import { AnomalyDetector } from './anomaly-detector.js';
import { SecurityReporter } from './security-reporter.js';

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

// v0.3.0 新增模块
const dcaScheduler = new DcaScheduler(DATA_DIR, exchangeManager, orderExecutor);
const arbitrageScanner = new ArbitrageScanner(DATA_DIR, exchangeManager);
const fundingRateMonitor = new FundingRateMonitor(DATA_DIR, exchangeManager);

// v0.4.0 新增模块
const conditionalOrderManager = new ConditionalOrderManager(DATA_DIR, exchangeManager, orderExecutor);
const anomalyDetector = new AnomalyDetector(DATA_DIR, exchangeManager, vault);
const securityReporter = new SecurityReporter(DATA_DIR, vault, exchangeManager);

// ─── 导出 ───

export {
  vault,
  exchangeManager,
  orderExecutor,
  riskGuard,
  portfolioTracker,
  balanceMonitor,
  pnlTracker,
  dcaScheduler,
  arbitrageScanner,
  fundingRateMonitor,
  conditionalOrderManager,
  anomalyDetector,
  securityReporter,
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
export type { DcaPlan, DcaExecutionRecord, DcaPlanSummary, DcaEvent, DcaFrequency } from './dca-scheduler.js';
export type { ArbitrageConfig, ArbitrageOpportunity, ArbitrageAlert } from './arbitrage-scanner.js';
export type { FundingRateConfig, FundingRateInfo, FundingRateOpportunity, FundingRateAlert } from './funding-rate-monitor.js';
export type { ConditionalOrder, ConditionalOrderExecution, ConditionalOrderEvent, ConditionType, TriggerMode, ConditionalOrderStatus } from './conditional-order.js';
export type { AnomalyConfig, AnomalyEvent, AnomalyType } from './anomaly-detector.js';
export type { SecurityReport, SecurityReporterConfig, SecurityReportEvent, SecurityCheckItem, ExchangeSecurityReport } from './security-reporter.js';
