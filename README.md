# TradeOS

**An OpenClaw Skill for centralized exchange trading, portfolio monitoring & PnL tracking.**

Trade on 100+ cryptocurrency exchanges via natural language. Manage API keys securely, monitor balances in real-time, and track your profit & loss — all from your OpenClaw chat interface.

[中文文档](./README_CN.md)

---

## Features

### Secure API Key Management
- AES-256-GCM encryption with PBKDF2-derived keys (600K iterations)
- Automatically rejects API keys with withdrawal permissions
- Credentials stored locally at `~/.openclaw/skills/cex-trading/vault/`
- API keys are always masked in logs and chat messages

### Multi-Exchange Trading
- Powered by [CCXT](https://github.com/ccxt/ccxt) — supports **100+ exchanges** with a unified API
- Order types: Market, Limit, Stop-Loss, Take-Profit
- Spot and Futures trading with leverage control
- **Mandatory preview + confirmation** before every trade execution

### Risk Management
- Per-order value limit (default $10,000)
- Daily cumulative volume limit (default $50,000)
- Maximum leverage cap (default 10x)
- Cooldown period between trades on the same pair
- Blocked symbol blacklist
- All rules fully customizable

### Portfolio Tracking
- Multi-exchange aggregated balance overview
- USD valuation for all holdings
- Historical snapshots stored in SQLite
- Daily summary and net value curve

### Balance Monitoring & Alerts
- **Price alerts** — notify when a coin crosses a price level
- **Balance change alerts** — notify when a coin balance changes significantly
- **Portfolio drawdown alerts** — notify when total assets drop by a percentage
- **Portfolio gain alerts** — notify when total assets rise by a percentage
- Configurable cooldown to prevent alert spam
- Polling-based monitoring (default 60s interval)

### PnL Reporting
- Generate reports by period: 1 day / 7 days / 30 days / 90 days
- Breakdown by asset with individual change tracking
- Trade statistics: total trades, win rate, fees paid
- Formatted text output ready for chat display

---

## Supported Exchanges

Out of the box, TradeOS is configured for these popular exchanges:

| Exchange | ID |
|----------|-----|
| Binance | `binance` |
| OKX | `okx` |
| Bybit | `bybit` |
| Gate.io | `gateio` |
| Bitget | `bitget` |
| Coinbase | `coinbase` |
| KuCoin | `kucoin` |
| HTX (Huobi) | `htx` |
| MEXC | `mexc` |
| Crypto.com | `cryptocom` |

Since TradeOS is built on CCXT, any of the 100+ supported exchanges can be added.

---

## Installation

### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- Node.js >= 22

### Install the Skill

```bash
# Clone the repository
git clone https://github.com/00xLazy/TradeOS.git ~/.openclaw/skills/cex-trading

# Install dependencies
cd ~/.openclaw/skills/cex-trading
npm install
```

OpenClaw will automatically detect the `SKILL.md` and load the skill.

---

## Usage

Once installed, interact with TradeOS through your OpenClaw chat interface (Telegram, Discord, WhatsApp, etc.).

### Add an Exchange API Key

```
You:   Add my Binance API key
Agent: Please provide your API Key and Secret.
       Security reminder: only grant "trade" permission — never enable "withdraw".

You:   API Key is xxxxx, Secret is yyyyy
Agent: Encrypted and stored. Detected permissions: spot, futures. No withdrawal — safe.
```

### Check Balances

```
You:   Show me my assets
Agent:
       Asset Overview
       ──────────────
       Binance:  $45,230 (0.3 BTC, 5 ETH, 10000 USDT)
       OKX:      $12,800 (2 SOL, 8000 USDT)
       ──────────────
       Total: $58,030
       Distribution: BTC 42% | ETH 20% | USDT 31% | SOL 7%
```

### Place a Trade

```
You:   Buy 0.1 BTC on Binance
Agent:
       Order Confirmation
       ──────────────
       Exchange: Binance
       Pair:     BTC/USDT
       Side:     Buy
       Type:     Market
       Amount:   0.1 BTC
       Price:    $84,302
       Est Cost: $8,430.20
       Est Fee:  $8.43
       ──────────────
       Reply "confirm" to execute.

You:   Confirm
Agent: Filled. Avg price $84,302.50, amount 0.1 BTC, fee 0.0001 BTC.
```

### Set Price Alert

```
You:   Alert me if BTC drops below $80,000
Agent: Price alert set: BTC < $80,000 — will notify via Telegram.
```

### Check PnL

```
You:   How much did I make this week?
Agent:
       📈 Weekly Report
       ────────────────────
       Start:   $58,200
       Current: $61,530
       PnL:     +$3,330 (+5.72%)
       ────────────────────
       By asset:
         BTC: +$2,100
         ETH: +$890
         SOL: +$340
       ────────────────────
       Trades: 12 | Win rate: 66.7% | Fees: $23.50
```

---

## Project Structure

```
cex-trading/
├── SKILL.md                         # OpenClaw skill descriptor
├── package.json                     # Dependencies (ccxt, better-sqlite3)
├── tsconfig.json
└── scripts/
    ├── index.ts                     # Entry point — initializes all modules
    ├── key-vault.ts                 # API key encrypted storage (AES-256-GCM)
    ├── exchange-manager.ts          # CCXT multi-exchange connection manager
    ├── order-executor.ts            # Order execution engine
    ├── risk-guard.ts                # Risk management module
    ├── portfolio-tracker.ts         # Portfolio snapshots & history (SQLite)
    ├── balance-monitor.ts           # Balance monitoring & alert rules
    └── pnl-tracker.ts              # PnL tracking & report generation
```

### Module Overview

| Module | Responsibility |
|--------|---------------|
| `key-vault` | AES-256-GCM encrypted API key storage, PBKDF2 key derivation, withdrawal permission rejection |
| `exchange-manager` | Unified multi-exchange interface via CCXT, balance queries, ticker data, market aggregation |
| `order-executor` | Market/limit/stop-loss/take-profit orders, mandatory preview + confirm flow, leverage control |
| `risk-guard` | Per-order limits, daily volume caps, max leverage, cooldown periods, symbol blacklist |
| `portfolio-tracker` | SQLite-based asset snapshots, historical comparison, net value curves, daily summaries |
| `balance-monitor` | 6 alert types (price/balance/drawdown/gain/margin/transfer), polling-based monitoring |
| `pnl-tracker` | Period-based PnL reports (1d/7d/30d/90d), per-asset breakdown, trade statistics |

---

## Data Storage

All data is stored locally on your machine:

```
~/.openclaw/skills/cex-trading/
├── vault/
│   └── exchanges.enc.json    # Encrypted API keys
├── data/
│   ├── portfolio.db          # Asset snapshot history (SQLite)
│   └── trades.db             # Trade records (SQLite)
├── alerts/
│   └── rules.json            # Alert rule configuration
└── risk-rules.json           # Risk management rules
```

- **No data leaves your machine** — everything runs locally
- API keys encrypted with AES-256-GCM
- SQLite databases for efficient local storage
- `.gitignore` excludes all sensitive files (`*.enc.json`, `*.db`)

---

## Security

### What TradeOS does

- Encrypts all API keys with AES-256-GCM before writing to disk
- Rejects API keys that have withdrawal permissions
- Requires explicit user confirmation before every trade
- Masks API keys in all logs and messages
- Enforces configurable risk limits on every order
- Sets file permissions to `600` (owner-only) on vault files

### What you should do

- **Never grant withdrawal permissions** to your API keys
- **Set IP whitelists** on your exchange API keys
- Use a **strong master password** for the key vault
- **Review risk rules** and adjust limits to your risk tolerance
- Run OpenClaw on a **secure, private machine**

---

## License

[MIT](./LICENSE)

---

## Acknowledgments

- [OpenClaw](https://github.com/openclaw/openclaw) — the open-source AI agent platform
- [CCXT](https://github.com/ccxt/ccxt) — unified cryptocurrency exchange API
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — fast, synchronous SQLite for Node.js
