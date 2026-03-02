# TradeOS

**一个用于中心化交易所交易、资产监控和损益追踪的 OpenClaw Skill。**

通过自然语言在 100+ 家加密货币交易所进行交易。安全管理 API Key，实时监控余额，追踪盈亏——一切都在 OpenClaw 聊天界面中完成。

[English Documentation](./README.md)

---

## 功能特性

### 安全的 API Key 管理
- AES-256-GCM 加密，PBKDF2 密钥派生（60 万次迭代）
- 自动拒绝含提现权限的 API Key
- 凭证本地加密存储于 `~/.openclaw/skills/cex-trading/vault/`
- 日志和聊天消息中 API Key 自动脱敏显示

### 多交易所交易
- 基于 [CCXT](https://github.com/ccxt/ccxt) 库——统一 API 支持 **100+ 家交易所**
- 订单类型：市价单、限价单、止损单、止盈单
- 支持现货和合约交易，可设置杠杆倍数
- **每笔交易必须经过预览 + 确认**才会执行

### 风控系统
- 单笔金额限制（默认 $10,000）
- 日累计交易量限制（默认 $50,000）
- 最大杠杆倍数限制（默认 10x）
- 同一交易对连续下单冷却期
- 交易对黑名单
- 所有规则均可自定义

### 资产追踪
- 多交易所聚合资产总览
- 所有持仓的 USD 估值
- SQLite 存储历史快照
- 每日摘要和净值曲线

### 余额监控与告警
- **价格告警** — 币种价格突破或跌破指定水平时通知
- **余额变动告警** — 某币种余额发生显著变化时通知
- **资产跌幅告警** — 总资产下跌超过指定百分比时通知
- **资产涨幅告警** — 总资产上涨超过指定百分比时通知
- 可配置冷却时间，防止告警刷屏
- 轮询监控模式（默认 60 秒间隔）

### 损益报告
- 按周期生成报告：1 天 / 7 天 / 30 天 / 90 天
- 按币种拆分收益明细
- 交易统计：总交易笔数、胜率、手续费
- 格式化文本输出，适合聊天展示

---

## 支持的交易所

开箱即用，TradeOS 已配置以下主流交易所：

| 交易所 | ID |
|--------|-----|
| 币安 Binance | `binance` |
| 欧易 OKX | `okx` |
| Bybit | `bybit` |
| Gate.io | `gateio` |
| Bitget | `bitget` |
| Coinbase | `coinbase` |
| KuCoin | `kucoin` |
| 火币 HTX | `htx` |
| MEXC | `mexc` |
| Crypto.com | `cryptocom` |

由于基于 CCXT 构建，理论上可以添加任何 CCXT 支持的 100+ 家交易所。

---

## 安装

### 前置要求

- 已安装并运行 [OpenClaw](https://github.com/openclaw/openclaw)
- Node.js >= 22

### 安装 Skill

```bash
# 克隆仓库到 OpenClaw 技能目录
git clone https://github.com/00xLazy/TradeOS.git ~/.openclaw/skills/cex-trading

# 安装依赖
cd ~/.openclaw/skills/cex-trading
npm install
```

OpenClaw 会自动检测 `SKILL.md` 并加载该技能。

---

## 使用方法

安装后，通过 OpenClaw 聊天界面（Telegram、Discord、WhatsApp 等）与 TradeOS 交互。

### 添加交易所 API Key

```
你:     帮我添加币安的 API Key
Agent:  好的，请提供你的 API Key 和 Secret。
        安全提醒：请只授予"交易"权限，不要开启"提现"权限。

你:     API Key 是 xxxxx，Secret 是 yyyyy
Agent:  ✅ 已加密存储。检测到权限：现货、合约。无提现权限，安全。
```

### 查看资产

```
你:     看看我的资产
Agent:
        💰 资产总览
        ──────────────
        Binance:  $45,230 (0.3 BTC, 5 ETH, 10000 USDT)
        OKX:      $12,800 (2 SOL, 8000 USDT)
        ──────────────
        总计: $58,030
        分布: BTC 42% | ETH 20% | USDT 31% | SOL 7%
```

### 交易下单

```
你:     帮我在币安买 0.1 个 BTC
Agent:
        📋 订单确认
        ──────────────
        交易所: Binance
        交易对: BTC/USDT
        方向:   买入
        类型:   市价单
        数量:   0.1 BTC
        当前价: $84,302
        预估花费: $8,430.20
        预估手续费: $8.43
        ──────────────
        请回复"确认"执行此订单。

你:     确认
Agent:  ✅ 成交。均价 $84,302.50，数量 0.1 BTC，手续费 0.0001 BTC。
```

### 设置价格告警

```
你:     BTC 跌破 8 万通知我
Agent:  ✅ 已设置价格告警：BTC < $80,000 时通过 Telegram 通知你。
```

### 设置资产告警

```
你:     总资产 24 小时跌超 5% 也通知我
Agent:  ✅ 已设置资产跌幅告警：24h 总资产跌幅 > 5% 时通知。
```

### 查看收益

```
你:     我这周赚了多少
Agent:
        📈 本周收益报告
        ────────────────────
        期初总资产: $58,200
        当前总资产: $61,530
        收益: +$3,330 (+5.72%)
        ────────────────────
        币种明细:
          BTC: +$2,100
          ETH: +$890
          SOL: +$340
        ────────────────────
        交易统计:
          总交易: 12 笔
          胜率: 66.7%
          总手续费: $23.50
```

---

## 项目结构

```
cex-trading/
├── SKILL.md                         # OpenClaw 技能描述文件
├── package.json                     # 依赖 (ccxt, better-sqlite3)
├── tsconfig.json
└── scripts/
    ├── index.ts                     # 统一入口，初始化所有模块
    ├── key-vault.ts                 # API Key 加密存储 (AES-256-GCM)
    ├── exchange-manager.ts          # CCXT 多交易所连接管理
    ├── order-executor.ts            # 订单执行引擎
    ├── risk-guard.ts                # 风控模块
    ├── portfolio-tracker.ts         # 资产快照与历史 (SQLite)
    ├── balance-monitor.ts           # 余额监控与告警规则
    └── pnl-tracker.ts              # 损益追踪与报告生成
```

### 模块说明

| 模块 | 职责 |
|------|------|
| `key-vault` | AES-256-GCM 加密存储 API Key，PBKDF2 密钥派生，拒绝含提现权限的 Key |
| `exchange-manager` | 基于 CCXT 的多交易所统一接口，余额查询、行情查询、多所聚合 |
| `order-executor` | 市价/限价/止损/止盈订单，强制预览+确认流程，合约杠杆控制 |
| `risk-guard` | 单笔限额、日累计限额、最大杠杆、冷却期、交易对黑名单，规则可自定义 |
| `portfolio-tracker` | SQLite 存储资产快照，历史对比，净值曲线，每日摘要 |
| `balance-monitor` | 6 种告警类型（价格/余额变动/跌幅/涨幅/保证金/大额转账），轮询监控 |
| `pnl-tracker` | 按周期生成损益报告（1d/7d/30d/90d），按币种拆分，交易统计（胜率/手续费） |

---

## 数据存储

所有数据存储在本地：

```
~/.openclaw/skills/cex-trading/
├── vault/
│   └── exchanges.enc.json    # 加密的 API Key
├── data/
│   ├── portfolio.db          # 资产快照历史 (SQLite)
│   └── trades.db             # 交易记录 (SQLite)
├── alerts/
│   └── rules.json            # 告警规则配置
└── risk-rules.json           # 风控规则配置
```

- **数据不会离开你的设备** — 一切在本地运行
- API Key 使用 AES-256-GCM 加密
- SQLite 数据库高效本地存储
- `.gitignore` 已排除所有敏感文件（`*.enc.json`、`*.db`）

---

## 安全须知

### TradeOS 做了什么

- 所有 API Key 写入磁盘前使用 AES-256-GCM 加密
- 拒绝存储含提现权限的 API Key
- 每笔交易必须用户明确确认后才执行
- 日志和消息中 API Key 自动脱敏
- 每笔订单强制执行可配置的风控规则
- Vault 文件权限设为 `600`（仅 owner 可读写）

### 你应该做什么

- **永远不要给 API Key 授予提现权限**
- **在交易所后台设置 IP 白名单**
- 使用**强密码**作为 Key Vault 的主密码
- **检查并调整风控规则**，使其符合你的风险承受能力
- 在**安全的私人设备**上运行 OpenClaw

---

## 许可证

[MIT](./LICENSE)

---

## 致谢

- [OpenClaw](https://github.com/openclaw/openclaw) — 开源 AI Agent 平台
- [CCXT](https://github.com/ccxt/ccxt) — 统一加密货币交易所 API
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — 高性能 Node.js SQLite 库
