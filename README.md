<div align="center">

```
████████╗██████╗  █████╗ ██████╗ ███████╗ ██████╗ ███████╗
╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔═══██╗██╔════╝
   ██║   ██████╔╝███████║██║  ██║█████╗  ██║   ██║███████╗
   ██║   ██╔══██╗██╔══██║██║  ██║██╔══╝  ██║   ██║╚════██║
   ██║   ██║  ██║██║  ██║██████╔╝███████╗╚██████╔╝███████║
   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝
```

### `> Institutional-grade CEX trading infrastructure for AI agents_`

<br />

[![Version](https://img.shields.io/badge/v0.4.0-blueviolet?style=for-the-badge&logo=semver&logoColor=white)](https://github.com/00xLazy/TradeOS/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CCXT](https://img.shields.io/badge/CCXT-100%2B_Exchanges-00d4aa?style=for-the-badge&logo=bitcoin&logoColor=white)](https://github.com/ccxt/ccxt)
[![License](https://img.shields.io/badge/MIT-License-f59e0b?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](./LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Skill-ff6b6b?style=for-the-badge&logo=openai&logoColor=white)](https://github.com/openclaw/openclaw)

<br />

[English](./README.md) · [简体中文](./README_CN.md)

<br />

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

</div>

<br />

## What is TradeOS?

> **One sentence to trade. One layer to rule them all.**

TradeOS is an [OpenClaw](https://github.com/openclaw/openclaw) Skill that transforms natural language into secure, auditable exchange operations across **100+ centralized cryptocurrency exchanges**. It functions as a complete trading infrastructure layer — handling key management, order execution, risk enforcement, portfolio analytics, and autonomous strategies — so AI agents can operate with the same rigor expected of institutional trading desks.

```
┌─────────────────────────────────────────────────────────────┐
│  All keys encrypted at rest (AES-256-GCM)                   │
│  All data stays local — zero cloud dependency               │
│  All trades require explicit confirmation                    │
└─────────────────────────────────────────────────────────────┘
```

<br />

<div align="center">
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />
</div>

<br />

## Feature Matrix

<table>
<tr>
<td width="50%">

### Security & Infrastructure
| Module | Capability |
|:--|:--|
| **Key Vault** | AES-256-GCM + PBKDF2 (600K iter) |
| **Risk Guard** | Per-order limits, daily caps, leverage ceilings |
| **Anomaly Detection** | Balance drops, unknown orders, API failures |
| **Security Auditor** | Per-exchange health scoring |

</td>
<td width="50%">

### Trading & Analytics
| Module | Capability |
|:--|:--|
| **Trading Engine** | Market / Limit / Stop / TP across spot & futures |
| **Portfolio Tracker** | Multi-exchange aggregation & snapshots |
| **PnL Reports** | Daily, weekly, monthly & quarterly reports |

</td>
</tr>
<tr>
<td width="50%">

### Autonomous Strategies
| Module | Capability |
|:--|:--|
| **DCA Scheduler** | Hourly / Daily / Weekly / Monthly auto-buys |
| **Conditional Orders** | Price triggers, once or recurring + cooldowns |

</td>
<td width="50%">

### Market Intelligence
| Module | Capability |
|:--|:--|
| **Arbitrage Scanner** | Cross-exchange spread detection (net of fees) |
| **Funding Rates** | Perpetual contract yield tracking & alerts |

</td>
</tr>
</table>

<br />

<div align="center">
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />
</div>

<br />

## Architecture

```mermaid
flowchart TB
    User["User (Natural Language)"] --> OpenClaw["OpenClaw Agent"]
    OpenClaw --> Core["TradeOS Core"]

    Core --> Vault["Key Vault\n(AES-256-GCM)"]
    Core --> EM["Exchange Manager"]
    Core --> OE["Order Executor"]
    Core --> RG["Risk Guard"]

    EM --> CCXT["CCXT"]
    CCXT --> EX["100+ Exchanges"]

    OE --> EM
    RG --> OE

    Core --> DCA["DCA Scheduler"]
    Core --> ARB["Arbitrage Scanner"]
    Core --> FR["Funding Monitor"]
    Core --> CO["Conditional Orders"]
    Core --> AD["Anomaly Detector"]
    Core --> SR["Security Reporter"]

    DCA --> OE
    CO --> OE

    Core --> DB[("SQLite\nPortfolio DB\nTrade DB")]

    style User fill:#0d1117,stroke:#58a6ff,color:#c9d1d9,stroke-width:2px
    style OpenClaw fill:#0d1117,stroke:#58a6ff,color:#c9d1d9,stroke-width:2px
    style Core fill:#161b22,stroke:#f78166,color:#f0f6fc,stroke-width:3px
    style Vault fill:#161b22,stroke:#7ee787,color:#c9d1d9,stroke-width:2px
    style EM fill:#161b22,stroke:#7ee787,color:#c9d1d9,stroke-width:2px
    style OE fill:#161b22,stroke:#7ee787,color:#c9d1d9,stroke-width:2px
    style RG fill:#161b22,stroke:#7ee787,color:#c9d1d9,stroke-width:2px
    style CCXT fill:#0d1117,stroke:#d2a8ff,color:#c9d1d9,stroke-width:2px
    style EX fill:#0d1117,stroke:#d2a8ff,color:#c9d1d9,stroke-width:2px
    style DCA fill:#161b22,stroke:#79c0ff,color:#c9d1d9
    style ARB fill:#161b22,stroke:#79c0ff,color:#c9d1d9
    style FR fill:#161b22,stroke:#79c0ff,color:#c9d1d9
    style CO fill:#161b22,stroke:#79c0ff,color:#c9d1d9
    style AD fill:#161b22,stroke:#79c0ff,color:#c9d1d9
    style SR fill:#161b22,stroke:#79c0ff,color:#c9d1d9
    style DB fill:#0d1117,stroke:#ffa657,color:#c9d1d9,stroke-width:2px
```

<br />

<div align="center">
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />
</div>

<br />

## Quick Start

```bash
# 1. Clone into your OpenClaw skills directory
git clone https://github.com/00xLazy/TradeOS.git ~/.openclaw/skills/TradeOS

# 2. Install & build
cd ~/.openclaw/skills/TradeOS && npm install && npm run build
```

Then, in your OpenClaw agent:

```
> "Initialize my TradeOS vault with a master password."
> "Add my Binance API key. The key is XXXX and the secret is YYYY."
```

TradeOS will encrypt the credentials, verify the connection, check permission scopes, and **reject any key with withdrawal access enabled**.

<br />

<div align="center">
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />
</div>

<br />

## Supported Exchanges

<div align="center">

| Exchange | ID | Spot | Futures | |
|:--|:--|:--:|:--:|:--|
| **Binance** | `binance` | Yes | Yes | World's largest by volume |
| **OKX** | `okx` | Yes | Yes | Advanced derivatives platform |
| **Bybit** | `bybit` | Yes | Yes | Leading perpetuals exchange |
| **Gate.io** | `gateio` | Yes | Yes | 1700+ trading pairs |
| **Bitget** | `bitget` | Yes | Yes | Copy-trading leader |
| **Coinbase** | `coinbase` | Yes | — | Regulated US exchange |
| **KuCoin** | `kucoin` | Yes | Yes | The people's exchange |
| **HTX** | `htx` | Yes | Yes | Global digital asset platform |
| **MEXC** | `mexc` | Yes | Yes | Fast listing exchange |
| **Crypto.com** | `cryptocom` | Yes | — | Consumer-friendly platform |

</div>

> **100+ additional exchanges** supported via [CCXT](https://github.com/ccxt/ccxt). If your exchange speaks REST, TradeOS can trade on it.

<br />

<div align="center">
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />
</div>

<br />

## Usage Examples

<details open>
<summary><strong>Trading</strong></summary>

```
You:     Buy 0.1 BTC on Binance at market price.

TradeOS: ┌─ Order Preview ───────────────────────┐
         │ Exchange:    Binance                   │
         │ Pair:        BTC/USDT                  │
         │ Side:        BUY                       │
         │ Type:        Market                    │
         │ Amount:      0.1 BTC                   │
         │ Est. Cost:   ~$8,430.20                │
         │ Est. Fee:    ~$8.43                    │
         │ Risk Check:  PASSED                    │
         └────────────────────────────────────────┘
         Reply "confirm" to execute.

You:     confirm

TradeOS: Filled @ $84,302.50 | 0.1 BTC | Fee: 0.0001 BTC
```

</details>

<details>
<summary><strong>DCA Automation</strong></summary>

```
You:     Set up a daily DCA plan to buy $100 of ETH on Bybit at 9am.

TradeOS: ┌─ DCA Plan Created ───────────────────┐
         │ Name:       Daily ETH DCA             │
         │ Exchange:   Bybit                     │
         │ Pair:       ETH/USDT                  │
         │ Amount:     $100/day @ 09:00 UTC      │
         │ Status:     RUNNING                   │
         │ Next exec:  Tomorrow 09:00            │
         └────────────────────────────────────────┘
```

</details>

<details>
<summary><strong>Arbitrage Scanning</strong></summary>

```
You:     Scan for arbitrage on BTC/USDT across Binance, OKX, and Bybit.

TradeOS: ┌─ Arbitrage Results ──────────────────┐
         │                                       │
         │ BTC/USDT                              │
         │ Buy on OKX:        $84,290 (ask)      │
         │ Sell on Binance:   $84,350 (bid)      │
         │ Gross spread:      0.071%             │
         │ Net profit:        0.051% (after fees)│
         │                                       │
         │ Below 0.1% threshold — monitor only   │
         └────────────────────────────────────────┘
```

</details>

<details>
<summary><strong>Portfolio Overview</strong></summary>

```
You:     Show me my total balance across all exchanges.

TradeOS: ┌─ Portfolio Summary ──────────────────┐
         │                                       │
         │ Binance .............. $45,230.00      │
         │ OKX ................. $12,800.00      │
         │ Bybit ................. $3,200.00     │
         │                    ──────────────      │
         │ Total:              $61,230.00        │
         │                                       │
         │ ██████████████░░░░░░ BTC   42%        │
         │ █████████░░░░░░░░░░░ ETH   20%        │
         │ ███████░░░░░░░░░░░░░ USDT  31%        │
         │ ██░░░░░░░░░░░░░░░░░░ SOL    7%        │
         └────────────────────────────────────────┘
```

</details>

<details>
<summary><strong>Conditional Orders</strong></summary>

```
You:     If ETH drops below $3,000, buy 2 ETH on OKX.

TradeOS: ┌─ Conditional Order ─────────────────┐
         │ Trigger:    ETH/USDT < $3,000.00     │
         │ Action:     BUY 2 ETH @ Market       │
         │ Exchange:   OKX                       │
         │ Mode:       One-time                  │
         │ Status:     MONITORING (every 15s)    │
         └────────────────────────────────────────┘
```

</details>

<br />

<div align="center">
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />
</div>

<br />

## Data Storage

All data is stored **locally on your machine**. Nothing is transmitted to external servers.

```
~/.openclaw/skills/TradeOS/
│
├── vault/
│   └── exchanges.enc.json          Encrypted API credentials
│
├── data/
│   ├── portfolio.db                Asset snapshots (SQLite)
│   └── trades.db                   Trade records (SQLite)
│
├── alerts/
│   └── rules.json                  Alert rule definitions
│
├── dca/
│   ├── plans.json                  DCA plan configurations
│   └── history.json                DCA execution log
│
├── arbitrage/
│   └── config.json                 Arbitrage scanner settings
│
├── funding/
│   └── config.json                 Funding rate monitor settings
│
├── conditional-orders/
│   ├── orders.json                 Conditional order definitions
│   └── history.json                Execution history
│
├── anomaly/
│   ├── config.json                 Anomaly detection settings
│   └── snapshots.json              Balance snapshot history
│
├── security/
│   ├── config.json                 Security auditor settings
│   └── last-report.json            Most recent security report
│
└── risk-rules.json                 Risk management rules
```

<br />

<div align="center">
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />
</div>

<br />

## Security

<table>
<tr>
<td>

### TradeOS Enforces

- **AES-256-GCM** encryption for all stored credentials
- Automatic **rejection** of keys with withdrawal access
- Mandatory **preview + confirm** flow for manual trades
- File permissions set to **`chmod 600`** (owner-only)
- Full API key **masking** in logs and chat output
- Risk guard **always active** — even for automated strategies

</td>
<td>

### You Should Configure

- **Never** enable withdrawal on API keys
- **IP whitelist** on every exchange API key
- **Strong, unique** master password for the vault
- **Risk limits** matching your risk tolerance
- Run on a **secure, private** machine

</td>
</tr>
</table>

<br />

<div align="center">
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />
</div>

<br />

<details>
<summary><strong>Project Structure</strong></summary>

<br />

| Module | File | Role |
|:--|:--|:--|
| Entry Point | `scripts/index.ts` | Initializes and exports all modules |
| Key Vault | `scripts/key-vault.ts` | AES-256-GCM credential encryption and storage |
| Exchange Manager | `scripts/exchange-manager.ts` | CCXT exchange connections, balances, tickers |
| Order Executor | `scripts/order-executor.ts` | Order preview, confirmation, and execution |
| Risk Guard | `scripts/risk-guard.ts` | Pre-trade risk checks and enforcement |
| Portfolio Tracker | `scripts/portfolio-tracker.ts` | Multi-exchange balance aggregation and snapshots |
| Balance Monitor | `scripts/balance-monitor.ts` | Price, balance, and drawdown alerts |
| PnL Tracker | `scripts/pnl-tracker.ts` | Trade history and performance reports |
| DCA Scheduler | `scripts/dca-scheduler.ts` | Automated dollar-cost averaging plans |
| Arbitrage Scanner | `scripts/arbitrage-scanner.ts` | Cross-exchange price spread detection |
| Funding Rate Monitor | `scripts/funding-rate-monitor.ts` | Perpetual contract funding rate analysis |
| Conditional Orders | `scripts/conditional-order.ts` | Trigger-based automated order execution |
| Anomaly Detector | `scripts/anomaly-detector.ts` | Account anomaly and integrity monitoring |
| Security Reporter | `scripts/security-reporter.ts` | API key health scoring and recommendations |
| Security Utilities | `scripts/security-utils.ts` | Shared cryptographic helpers |

</details>

<br />

## License

[MIT License](./LICENSE) — 00xLazy

<br />

<div align="center">
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

<br />

**Built with** [OpenClaw](https://github.com/openclaw/openclaw) · [CCXT](https://github.com/ccxt/ccxt) · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

<br />

```
Built for autonomous trading infrastructure.
```

<br />

<sub>Made by <a href="https://github.com/00xLazy">00xLazy</a></sub>

</div>
