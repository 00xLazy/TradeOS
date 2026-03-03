# Contributing to TradeOS

Thank you for considering contributing to TradeOS.

## Getting Started

```bash
git clone https://github.com/00xLazy/TradeOS.git
cd TradeOS
npm install
npm run build
```

## Development

```bash
# Watch mode for development
npm run dev

# Build for production
npm run build
```

## Project Structure

```
scripts/
├── index.ts                 # Entry point
├── key-vault.ts             # AES-256-GCM encrypted API key storage
├── exchange-manager.ts      # CCXT multi-exchange connection manager
├── order-executor.ts        # Order execution engine
├── risk-guard.ts            # Risk management module
├── portfolio-tracker.ts     # Asset snapshots (SQLite)
├── balance-monitor.ts       # Balance monitoring & alerts
├── pnl-tracker.ts           # PnL tracking & reports
├── dca-scheduler.ts         # Dollar-cost averaging scheduler
├── arbitrage-scanner.ts     # Cross-exchange arbitrage detection
├── funding-rate-monitor.ts  # Perpetual funding rate monitor
├── conditional-order.ts     # Conditional / trigger orders
├── anomaly-detector.ts      # Anomaly detection alerts
├── security-reporter.ts     # API key security auditor
└── security-utils.ts        # Shared security utilities
```

## Guidelines

- **TypeScript only.** All code must pass `tsc` with strict mode.
- **No external API keys in code.** All credentials must go through the encrypted vault.
- **Maintain the confirmation flow.** Every trade action must go through `previewOrder → executeOrder`. Never bypass this.
- **Risk guard integration.** New order types must pass through `risk-guard.ts` validation.
- **Test locally.** Verify against at least one exchange testnet before submitting.

## Pull Request Process

1. Fork and create a feature branch from `main`
2. Make your changes with clear, descriptive commits
3. Ensure `npm run build` completes without errors
4. Open a PR using the [pull request template](.github/PULL_REQUEST_TEMPLATE.md)
5. Describe what changed and why

## Security

If your contribution touches encryption, key storage, or trade execution, please review [SECURITY.md](./SECURITY.md) first. Changes to security-critical paths require additional review.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
