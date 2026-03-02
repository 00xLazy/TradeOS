# TradeOS

**一个用于中心化交易所交易、DCA 定投、条件单、跨所套利扫描、异常检测和安全报告的 OpenClaw Skill。**

通过自然语言在 100+ 家加密货币交易所进行交易。安全管理 API Key，自动化定投策略，设置条件触发订单，监控跨所套利机会，追踪资金费率收益，检测账户异常行为，管理你的整个投资组合——一切都在 OpenClaw 聊天界面中完成。

[English Documentation](./README.md)

---

## 功能特性

### 安全的 API Key 管理
- AES-256-GCM 加密，PBKDF2 密钥派生（60 万次迭代）
- 自动拒绝含提现权限的 API Key
- 凭证本地加密存储于 `~/.openclaw/skills/TradeOS/vault/`
- 日志和聊天消息中 API Key 自动脱敏显示

### 多交易所交易
- 基于 [CCXT](https://github.com/ccxt/ccxt) 库——统一 API 支持 **100+ 家交易所**
- 订单类型：市价单、限价单、止损单、止盈单
- 支持现货和合约交易，可设置杠杆倍数
- **每笔交易必须经过预览 + 确认**才会执行

### DCA 定投
- 创建自动定投计划：**每小时 / 每天 / 每周 / 每月**
- 可配置每次投入金额（以 USDT 计）
- 自动执行 `previewOrder → executeOrder` 流程（创建计划时即授权）
- 风控模块在每次执行时仍然生效
- 追踪每个计划的均价、总投入、未实现盈亏
- 完整的执行历史，含成功/失败记录

### 跨所套利扫描
- 实时比较同一币种在多个交易所的价格
- 使用 **ask/bid 价格**（非 last 价格）计算更真实的价差
- 净利润超过阈值时告警（默认 0.5%，扣除双边手续费）
- 可配置手续费估算和告警冷却时间
- **仅提醒** — 不自动交易

### 资金费率监控
- 跨交易所监控永续合约资金费率
- 计算当前费率的**年化收益率**
- 年化超过阈值时告警（默认 30%）
- 提示操作方向：正费率 → 做空收取；负费率 → 做多收取
- **仅提醒** — 不自动交易

### 条件单/计划委托
- 设置价格触发订单：达到目标价时自动买入/卖出
- 条件类型：价格上穿/下穿、价格涨幅/跌幅（百分比）
- 触发模式：**一次性**（单次执行）或**持续触发**（带冷却期）
- 可选过期时间，限时生效
- 自动执行 `previewOrder → executeOrder` 流程（创建时即授权）
- 风控模块在每次触发时仍然生效
- 完整执行历史追踪

### 异常检测告警
- **余额异常下降告警**（critical）— 短时间内总资产大幅下降时触发（默认 5 分钟内跌超 10%）
- **未知订单告警**（warning）— 检测到交易所出现异常订单活动
- **API 故障告警**（warning）— API 连续调用失败时触发（可能是 Key 过期或被禁用）
- 可配置阈值和冷却时间
- 余额快照持久化存储，重启不丢失

### 安全报告
- 定期审计所有已配置的 API Key 安全状态（默认每 24 小时一次）
- **百分制评分系统**，每个交易所满分 100 分：
  - API Key 年龄（25 分）— 超过 90 天警告，超过 180 天严重
  - 提现权限（25 分）— 检测到提现权限则 0 分
  - IP 白名单（25 分）— 未配置则扣分
  - API 连接状态（25 分）— 连接异常则 0 分
- 自动生成可操作的安全建议
- 支持手动触发报告生成

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
- **资产涨跌幅告警** — 总资产发生显著变动时通知
- 可配置冷却时间，防止告警刷屏

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
git clone https://github.com/00xLazy/TradeOS.git ~/.openclaw/skills/TradeOS

# 安装依赖
cd ~/.openclaw/skills/TradeOS
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
Agent:  已加密存储。检测到权限：现货、合约。无提现权限，安全。
```

### 查看资产

```
你:     看看我的资产
Agent:
        资产总览
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
        订单确认
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
Agent:  成交。均价 $84,302.50，数量 0.1 BTC，手续费 0.0001 BTC。
```

### 设置定投

```
你:     帮我设置一个每天 9 点在币安定投 100 美元 BTC 的计划
Agent:
        定投计划已创建
        ──────────────
        名称:     每日 BTC 定投
        交易所:   Binance
        交易对:   BTC/USDT
        金额:     $100/天
        时间:     每天 09:00
        状态:     运行中
        下次执行: 明天 09:00

你:     看看定投的收益怎么样
Agent:
        定投计划: 每日 BTC 定投
        ──────────────
        交易所: Binance | 交易对: BTC/USDT
        金额: $100/天 | 下次: 明天 09:00
        累计投入: $3,000 | 累计买入: 0.035 BTC
        均价: $85,714 | 现价: $87,200
        未实现盈亏: +$52 (+1.73%)
```

### 套利扫描

```
你:     帮我看看 BTC 有没有跨所套利机会
Agent:
        套利机会
        ──────────────
        BTC/USDT
        在 OKX 买入:      $84,200 (ask)
        在 Binance 卖出:   $84,650 (bid)
        价差: 0.53%
        净利润: 0.33% (扣除 0.1%×2 手续费)
```

### 资金费率监控

```
你:     看看 BTC 的资金费率
Agent:
        BTC/USDT:USDT 资金费率
        ──────────────
        Binance:  0.0350% (每8h) → 年化 38.3%
        OKX:      0.0280% (每8h) → 年化 30.7%
        Bybit:    0.0150% (每8h) → 年化 16.4%

        机会提示: Binance 费率偏高。
        建议: 做空 BTC 永续合约，收取多头支付的资金费率。
```

### 条件单

```
你:     BTC 跌到 8 万帮我买 0.01 个
Agent:
        条件单已创建
        ──────────────
        名称:     BTC 价格低于 $80,000 买入
        交易所:   Binance
        交易对:   BTC/USDT
        条件:     价格跌破 $80,000
        操作:     市价买入 0.01 BTC
        模式:     一次性
        状态:     监控中（每 15 秒检查）

你:     看看我的条件单
Agent:
        活跃条件单
        ──────────────
        1. BTC 跌破 80000 买入 — 监控中，0 次触发
        2. ETH 涨 5% 卖出 — 监控中，已触发 2 次
```

### 安全报告

```
你:     检查一下我的 API Key 安全状况
Agent:
        安全报告
        ──────────────
        总评分: 85/100 — 状态良好

        Binance:  90/100
          ✓ API Key 年龄: 45 天
          ✓ 无提现权限
          ✓ 已设置 IP 白名单（2 个 IP）
          ✓ API 连接正常

        OKX:      80/100
          ✓ API Key 年龄: 45 天
          ✓ 无提现权限
          ⚠ 未设置 IP 白名单
          ✓ API 连接正常

        建议:
          - OKX: 建议在交易所后台设置 IP 白名单
```

### 设置价格告警

```
你:     BTC 跌破 8 万通知我
Agent:  已设置价格告警：BTC < $80,000 时通知你。
```

### 查看收益

```
你:     我这周赚了多少
Agent:
        本周收益报告
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
TradeOS/
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
    ├── pnl-tracker.ts               # 损益追踪与报告生成
    ├── dca-scheduler.ts             # DCA 定投调度器
    ├── arbitrage-scanner.ts         # 跨所套利扫描
    ├── funding-rate-monitor.ts      # 资金费率监控
    ├── conditional-order.ts         # 条件单/计划委托
    ├── anomaly-detector.ts          # 异常检测告警
    └── security-reporter.ts         # 安全报告
```

### 模块说明

| 模块 | 职责 |
|------|------|
| `key-vault` | AES-256-GCM 加密存储 API Key，PBKDF2 密钥派生，拒绝含提现权限的 Key |
| `exchange-manager` | 基于 CCXT 的多交易所统一接口，余额查询、行情查询、多所聚合 |
| `order-executor` | 市价/限价/止损/止盈订单，强制预览+确认流程，合约杠杆控制 |
| `risk-guard` | 单笔限额、日累计限额、最大杠杆、冷却期、交易对黑名单，规则可自定义 |
| `portfolio-tracker` | SQLite 存储资产快照，历史对比，净值曲线，每日摘要 |
| `balance-monitor` | 多种告警类型（价格/余额变动/涨跌幅），轮询监控 |
| `pnl-tracker` | 按周期生成损益报告（1d/7d/30d/90d），按币种拆分，交易统计 |
| `dca-scheduler` | 自动定投计划（小时/日/周/月），执行历史，每计划盈亏追踪 |
| `arbitrage-scanner` | 跨交易所价差检测，ask/bid 比较，可配置利润阈值告警 |
| `funding-rate-monitor` | 永续合约费率监控，年化收益计算，操作方向建议 |
| `conditional-order` | 价格触发条件单，一次性/持续模式，自动执行含风控 |
| `anomaly-detector` | 余额异常检测，未知订单告警，API 故障追踪，可配置阈值 |
| `security-reporter` | 定期 API Key 安全审计，百分制评分，可操作建议 |

---

## 数据存储

所有数据存储在本地：

```
~/.openclaw/skills/TradeOS/
├── vault/
│   └── exchanges.enc.json    # 加密的 API Key
├── data/
│   ├── portfolio.db          # 资产快照历史 (SQLite)
│   └── trades.db             # 交易记录 (SQLite)
├── alerts/
│   └── rules.json            # 告警规则配置
├── dca/
│   ├── plans.json            # 定投计划配置
│   └── history.json          # 定投执行历史
├── arbitrage/
│   └── config.json           # 套利扫描配置
├── funding/
│   └── config.json           # 资金费率监控配置
├── conditional-orders/
│   ├── orders.json           # 条件单配置
│   └── history.json          # 条件单执行历史
├── anomaly/
│   ├── config.json           # 异常检测配置
│   └── snapshots.json        # 余额快照历史
├── security/
│   ├── config.json           # 安全报告配置
│   └── last-report.json      # 上次安全报告
└── risk-rules.json           # 风控规则配置
```

- **数据不会离开你的设备** — 一切在本地运行
- API Key 使用 AES-256-GCM 加密
- SQLite 数据库高效本地存储
- 所有配置/数据文件设为 `chmod 600`（仅所有者可读写）
- `.gitignore` 已排除所有敏感文件（`*.enc.json`、`*.db`）

---

## 安全须知

### TradeOS 做了什么

- 所有 API Key 写入磁盘前使用 AES-256-GCM 加密
- 拒绝存储含提现权限的 API Key
- 每笔交易必须用户明确确认后才执行（DCA 计划在创建时授权）
- 日志和消息中 API Key 自动脱敏
- 每笔订单强制执行可配置的风控规则
- 所有数据文件权限设为 `600`（仅 owner 可读写）

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
