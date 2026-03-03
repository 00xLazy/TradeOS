# Changelog

All notable changes to TradeOS will be documented in this file.

## [0.4.0] - 2025-05-01

### Added
- Anomaly detection alerts: balance drops, unknown orders, API failures
- Periodic security audit reports with scoring system (100-point scale)
- Multi-account support per exchange with explicit `accountLabel` routing
- Approval gate for DCA and conditional order auto-execution

### Changed
- Hardened order routing to prevent cross-account execution errors
- Improved error sanitization to prevent credential leakage in error messages

### Security
- DCA/conditional orders now pause when no approval callback is registered
- Added mandatory `accountLabel` disambiguation for multi-account setups

## [0.3.0] - 2025-03-15

### Added
- Conditional / trigger-based orders with one-shot and recurring modes
- Perpetual contract funding rate monitoring with annualized yield calculation
- Cross-exchange arbitrage scanner with net-profit threshold alerts

### Changed
- Risk guard now applies to all automated execution paths (DCA, conditional)

## [0.2.0] - 2025-02-01

### Added
- DCA (Dollar-Cost Averaging) scheduler with hourly/daily/weekly/monthly intervals
- PnL tracking per DCA plan: average price, total invested, unrealized gains
- DCA execution history with success/failure records

## [0.1.0] - 2025-01-01

### Added
- Initial release
- AES-256-GCM encrypted API key vault with PBKDF2 key derivation
- Multi-exchange trading via CCXT (100+ exchanges)
- Market, Limit, Stop-Loss, Take-Profit order types
- Spot and Futures trading with leverage control
- Mandatory preview + confirmation flow for all trades
- Portfolio tracking with SQLite-backed snapshots
- Balance monitoring with price, balance change, and drawdown alerts
- Risk management: per-trade limits, daily caps, max leverage, cooldowns
- PnL reporting by period (1d / 7d / 30d / 90d)
