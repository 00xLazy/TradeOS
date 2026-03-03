<div align="center">
  <img src="https://raw.githubusercontent.com/00xLazy/TradeOS/main/assets/logo.png" alt="TradeOS Logo" width="180" onerror="this.src='https://raw.githubusercontent.com/ccxt/ccxt/master/wiki/ccxt_logo.png';" />

  #  TradeOS
  
  **The Ultimate AI-Powered CEX Trading & Portfolio Automation Skill for OpenClaw**

  <p align="center">
    <a href="https://github.com/00xLazy/TradeOS/releases"><img src="https://img.shields.io/github/v/release/00xLazy/TradeOS?style=for-the-badge&color=6366f1" alt="Release"></a>
    <a href="https://github.com/ccxt/ccxt"><img src="https://img.shields.io/badge/Powered_by-CCXT-F3B05A?style=for-the-badge&logo=javascript&logoColor=white" alt="CCXT"></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
    <a href="https://github.com/00xLazy/TradeOS/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-success?style=for-the-badge" alt="License"></a>
  </p>

  <p align="center">
    Trade on 100+ cryptocurrency exchanges via natural language. Manage API keys securely, automate dollar-cost averaging, set conditional orders, monitor cross-exchange arbitrage opportunities, track funding rate yields, and manage your entire portfolio.
  </p>

  [English](./README.md) • [简体中文](./README_CN.md)
</div>

---

## ✨ Enterprise-Grade Features

### 🛡️ Fort Knox Security (Vault)
- **Zero-Trust Storage:** AES-256-GCM encryption with PBKDF2-derived keys (600K iterations).
- **Withdrawal Protection:** Automatically rejects and blocks API keys with withdrawal permissions.
- **Local Isolation:** Credentials stored locally at `~/.openclaw/skills/TradeOS/vault/`. No cloud syncing.
- **Data Masking:** API keys are universally masked in all logs and AI chat histories.

### 🌐 Omni-Exchange Engine
- **Powered by CCXT:** Instant access to **100+ exchanges** (Binance, Bybit, OKX, Kraken, etc.) via a unified API.
- **Advanced Routing:** Market, Limit, Stop-Loss, and Take-Profit orders.
- **Derivatives Ready:** Spot and Futures trading with dynamic leverage control.
- **Safety First:** Mandatory `preview + confirmation` flow before *any* live trade execution.

### 🤖 Smart Automation (DCA & Algos)
- **Dollar-Cost Averaging (DCA):** Create autonomous buy plans (Hourly / Daily / Weekly / Monthly).
- **Seamless Execution:** Automatic `previewOrder → executeOrder` pipeline (pre-authorized at creation).
- **Deep Analytics:** Track average buy prices, total invested capital, and unrealized PnL per strategy.

### 🔭 Market Intelligence
- **Cross-Exchange Arbitrage:** Real-time ask/bid spread calculation across venues. Alerts on net-profit thresholds.
- **Funding Rate Monitor:** Scans perpetual contract funding rates, calculating annualized yields. Spot lucrative long/short yield-farming opportunities.

### ⚡ Conditional Execution
- **Trigger-based Orders:** Buy or sell when assets hit strict price targets or percentage changes.
- **Flexible Modes:** 'Once-off' execution or 'Recurring' cycles with customizable cooldowns.

---

## 🚀 Quick Start

### 1. Installation

Since TradeOS is an OpenClaw Skill, you can install it directly into your OpenClaw environment:

```bash
# Clone the repository into your skills directory
git clone https://github.com/00xLazy/TradeOS.git ~/.openclaw/skills/TradeOS

# Navigate to the directory
cd ~/.openclaw/skills/TradeOS

# Install dependencies
npm install

# Build the skill
npm run build
```

### 2. Configuration & Initialization

Start your OpenClaw interface and say:
> *"Load the TradeOS skill."*

Once loaded, initialize your secure vault:
> *"Initialize my TradeOS vault with the password 'my-super-secret-password'."*

### 3. Adding Exchange Keys

To connect an exchange (e.g., Binance), ensure the API key **does not have withdrawal permissions**, then ask OpenClaw:
> *"Add my Binance API key. The key is XXX and the secret is YYY."*

*(TradeOS will encrypt and store this locally. It will test the connection and verify permission scopes before saving.)*

---

## 💬 Example Prompts

Talk to OpenClaw naturally to manage your portfolio:

* **Trading:** *"Buy $500 worth of BTC on Binance at market price."*
* **DCA:** *"Set up a daily DCA plan to buy $50 of ETH on Bybit."*
* **Arbitrage:** *"Scan for arbitrage opportunities between OKX and Binance for SOL/USDT."*
* **Yield Farming:** *"What are the current highest funding rates for perp contracts?"*
* **Portfolio:** *"Show me my total balance across all connected exchanges."*

---

## 🏗️ Architecture & Storage

```text
~/.openclaw/skills/TradeOS/
├── vault/
│   └── exchanges.enc.json    # Encrypted API keys
├── data/
│   ├── portfolio.db          # Asset snapshot history (SQLite)
│   └── trades.db             # Trade records (SQLite)
├── alerts/
│   └── rules.json            # Alert rule configuration
├── dca/
│   ├── plans.json            # DCA plan configuration
│   └── history.json          # DCA execution history
├── arbitrage/
│   └── config.json           # Arbitrage scanner configuration
├── funding/
│   └── config.json           # Funding rate monitor configuration
├── conditional-orders/
│   ├── orders.json           # Conditional order configuration
│   └── history.json          # Conditional order execution history
├── anomaly/
│   ├── config.json           # Anomaly detection configuration
│   └── snapshots.json        # Balance snapshot history
├── security/
│   ├── config.json           # Security reporter configuration
│   └── last-report.json      # Last security report
└── risk-rules.json           # Risk management rules
```

---

## 🔒 Security Best Practices

### What TradeOS does
- Encrypts all API keys with AES-256-GCM before writing to disk
- Rejects API keys that have withdrawal permissions
- Requires explicit user confirmation for manual trades
- Masks API keys in all logs and messages
- Sets file permissions to `600` (owner-only) on all data files

### What you should do
- **Never grant withdrawal permissions** to your API keys
- **Set IP whitelists** on your exchange API keys
- Use a **strong master password** for the key vault
- **Review risk rules** and adjust limits to your risk tolerance
- Run OpenClaw on a **secure, private machine**

---

## 📜 Acknowledgments & License

- [OpenClaw](https://github.com/openclaw/openclaw) — the open-source AI agent platform
- [CCXT](https://github.com/ccxt/ccxt) — unified cryptocurrency exchange API
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — fast, synchronous SQLite for Node.js

[MIT License](./LICENSE) © 2024 00xLazy

<div align="center">
  <p>Built for the decentralized future. Trade responsibly.</p>
</div>
