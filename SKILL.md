---
name: cex-trading
description: 中心化交易所交易与资产管理。通过自然语言在 Binance、OKX、Bybit 等 100+ 交易所下单交易，监控账户余额，追踪损益，支持条件单、异常检测和安全报告。
version: 0.4.0
author: 00xLazy
permissions:
  - filesystem
  - network
tags:
  - crypto
  - trading
  - exchange
  - portfolio
  - defi
  - dca
  - arbitrage
  - funding-rate
  - conditional-order
  - security
  - anomaly
---

# CEX Trading — 交易所交易与资产管理

## 1. Description

这个技能让你通过自然语言管理中心化交易所账户：添加 API Key、查询余额、下单交易、监控资产和追踪收益。

基于 CCXT 库，支持 Binance、OKX、Bybit、Gate.io、Bitget、Coinbase、KuCoin、HTX、MEXC、Crypto.com 等 100+ 家交易所。

**核心能力：**
- API Key 加密管理（AES-256-GCM）
- 现货 / 合约交易（市价单、限价单、止损单、止盈单）
- 多交易所资产总览与聚合
- 余额变动告警、价格告警、跌幅告警
- 日 / 周 / 月损益报告
- DCA 定投策略（按小时/日/周/月自动定投）
- 跨所套利机会扫描与告警
- 永续合约资金费率监控与套利提醒
- 条件单/计划委托（价格达标自动下单）
- 异常检测告警（余额异常、未知订单、API 故障）
- 定期安全报告（API Key 安全评分与建议）

## 2. When to use

- 用户想添加、查看或删除交易所 API Key
- 用户想查询交易所账户余额或持仓
- 用户想查看多个交易所的资产总览
- 用户想买入或卖出加密货币
- 用户想下限价单、止损单或止盈单
- 用户想查看挂单或撤销挂单
- 用户想查看交易历史
- 用户想设置价格告警或余额监控
- 用户想查看收益报告（日/周/月）
- 用户想了解某个币的当前价格
- 用户想设置定投计划（DCA）
- 用户想查看、暂停或删除定投计划
- 用户想监控跨交易所的套利机会
- 用户想查看资金费率或费率套利机会
- 用户想创建条件单（到达某个价格自动买入/卖出）
- 用户想查看或管理已有的条件单
- 用户想监控账户异常行为（余额突变、未知订单）
- 用户想查看 API Key 安全评分和安全建议
- 用户提到"交易"、"下单"、"买入"、"卖出"、"余额"、"持仓"、"资产"、"盈亏"、"定投"、"套利"、"费率"、"条件单"、"计划委托"、"异常"、"安全报告"等关键词

## 3. How to use

### 3.1 API Key 管理

**添加交易所 API Key：**

1. 询问用户要添加哪个交易所（binance / okx / bybit / gateio / bitget / coinbase / kucoin / htx / mexc / cryptocom）
2. 请求用户提供：API Key、Secret、Passphrase（OKX 需要）
3. 要求用户设置主密码（首次使用时）或输入已有主密码
4. 安全提醒用户：
   - 建议在交易所后台仅授予"交易"权限，**绝对不要开启"提现"权限**
   - 建议设置 IP 白名单
5. 调用 `key-vault.ts` 中的 `addCredential()` 加密存储
6. 自动检测 Key 权限并报告

**重要安全规则：**
- 如果用户的 API Key 包含提现(withdraw)权限，必须拒绝添加并警告用户
- 所有 API Key 在对话中必须脱敏显示（如 `aBcD...xYzW`）
- 永远不要在日志或消息中输出完整的 API Key 或 Secret

**查看已配置交易所：**
- 调用 `exchangeManager.listConfiguredExchanges()` 列出所有已添加的交易所

**删除 API Key：**
- 调用 `vault.removeCredential()` 删除指定交易所的凭证

### 3.2 余额查询

**查询单个交易所余额：**
```
调用 exchangeManager.getBalance(masterPassword, exchangeId)
```
返回各币种的可用、冻结、总量和 USD 估值。

**查询所有交易所总资产：**
```
调用 exchangeManager.getAllBalances(masterPassword)
```
返回每个交易所的余额 + 跨交易所聚合统计 + 总估值。

**显示格式示例：**
```
💰 资产总览
──────────────
Binance:  $45,230 (0.3 BTC, 5 ETH, 10000 USDT)
OKX:      $12,800 (2 SOL, 8000 USDT)
──────────────
总计: $58,030
分布: BTC 42% | ETH 20% | USDT 31% | SOL 7%
```

### 3.3 交易下单

**下单流程（必须严格遵循）：**

1. **解析意图**：从用户的自然语言中提取——交易所、交易对、方向(买/卖)、数量、订单类型、价格
2. **预览订单**：调用 `orderExecutor.previewOrder()` 获取当前价格和风控结果
3. **展示确认信息**：向用户展示完整的订单摘要
4. **等待用户确认**：用户必须明确说"确认"、"执行"、"好的"才能继续
5. **执行订单**：调用 `orderExecutor.executeOrder()`
6. **返回结果**：展示成交详情

**确认信息模板：**
```
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
⚠️ [风控警告（如有）]
请回复"确认"执行此订单。
```

**绝对禁止：**
- 永远不要跳过确认步骤直接执行交易
- 永远不要在用户没有明确确认的情况下执行
- 如果风控模块返回 blocked=true，必须拒绝执行并告知原因

**支持的订单类型：**
- 市价单：`买入 0.1 BTC` → market buy
- 限价单：`在 80000 挂单买 0.1 BTC` → limit buy
- 止损单：`BTC 跌到 78000 帮我卖出` → stop-loss sell
- 止盈单：`BTC 涨到 90000 帮我卖出` → take-profit sell

### 3.4 挂单管理

**查看挂单：**
```
调用 orderExecutor.getOpenOrders(masterPassword, exchangeId, symbol?)
```

**撤销挂单：**
1. 列出挂单让用户选择
2. 确认后调用 `orderExecutor.cancelOrder()`

### 3.5 余额监控与告警

**设置价格告警：**
```
调用 balanceMonitor.addRule({
  type: 'price_below' 或 'price_above',
  name: '用户可读的名称',
  enabled: true,
  params: { symbol: 'BTC/USDT', exchange: 'binance', threshold: 80000 },
  cooldownMs: 300000  // 触发后 5 分钟冷却
})
```

**设置资产跌幅告警：**
```
调用 balanceMonitor.addRule({
  type: 'portfolio_drawdown',
  name: '24h 跌幅超 5%',
  enabled: true,
  params: { threshold: 5, timeWindowMs: 86400000 },
  cooldownMs: 3600000
})
```

**设置余额变动告警：**
```
调用 balanceMonitor.addRule({
  type: 'balance_change',
  name: 'BTC 余额变动超 10%',
  enabled: true,
  params: { coin: 'BTC', threshold: 10 },
  cooldownMs: 600000
})
```

**启动/停止监控：**
```
balanceMonitor.start(masterPassword)  // 启动（默认 60s 轮询）
balanceMonitor.stop()                 // 停止
```

**查看所有告警规则：**
```
balanceMonitor.listRules()
```

### 3.6 损益报告

**生成收益报告：**
```
调用 pnlTracker.generateReport('7d')  // '1d' | '7d' | '30d' | '90d'
调用 pnlTracker.formatReport(report)  // 格式化为可读文本
```

**查看交易历史：**
```
调用 pnlTracker.getTradeHistory({ exchange: 'binance', limit: 20 })
```

### 3.7 行情查询

**查询币价：**
```
调用 exchangeManager.getTicker(masterPassword, exchangeId, 'BTC/USDT')
```

**显示格式：**
```
BTC/USDT (Binance)
价格: $84,302.50
24h 涨跌: +2.3%
24h 最高: $85,100 | 最低: $82,800
24h 成交量: 12,345 BTC
```

### 3.8 DCA 定投

**创建定投计划：**
```
调用 dcaScheduler.createPlan({
  name: '每日定投 BTC',
  exchangeId: 'binance',
  symbol: 'BTC/USDT',
  amountUSDT: 100,
  frequency: 'daily',        // 'hourly' | 'daily' | 'weekly' | 'monthly'
  executionTime: 9            // daily: 0-23小时; weekly: 0-6星期几; monthly: 1-28日
})
```

**启动/停止定投调度器：**
```
dcaScheduler.start(getPassword)   // 启动（30s 轮询检查执行时间）
dcaScheduler.stop()               // 停止
```

**管理计划：**
```
dcaScheduler.listPlans()                          // 列出所有计划
dcaScheduler.pausePlan(planId)                     // 暂停
dcaScheduler.resumePlan(planId)                    // 恢复
dcaScheduler.removePlan(planId)                    // 删除
dcaScheduler.getPlanSummary(masterPassword, planId) // 摘要含盈亏
dcaScheduler.getExecutionHistory(planId, 20)       // 执行历史
```

**显示格式示例：**
```
定投计划: 每日定投 BTC
──────────────
交易所: Binance | 交易对: BTC/USDT
金额: $100/天 | 下次执行: 明天 09:00
累计投入: $3,000 | 累计买入: 0.035 BTC
均价: $85,714 | 现价: $87,200
未实现盈亏: +$52 (+1.73%)
```

**重要说明：**
- DCA 在创建计划时即视为用户已授权，执行时自动走 previewOrder → executeOrder 流程，不需要每次确认
- 风控模块仍然生效，若被拦截则记录失败，不重试
- 注册 `dcaScheduler.onEvent(callback)` 可接收执行结果通知

### 3.9 跨所套利监控

**启动套利扫描：**
```
arbitrageScanner.start(getPassword)   // 启动（30s 轮询）
arbitrageScanner.stop()               // 停止
```

**配置监控：**
```
arbitrageScanner.updateConfig({
  symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
  exchanges: ['binance', 'okx', 'bybit'],
  minProfitPercent: 0.5,   // 净利润率阈值 (扣除双边手续费)
  feePercent: 0.1           // 单边手续费估算
})
arbitrageScanner.addSymbol('DOGE/USDT')   // 添加监控
arbitrageScanner.removeSymbol('SOL/USDT') // 移除监控
```

**手动扫描：**
```
const opportunities = await arbitrageScanner.scanNow(masterPassword)
```

**告警格式示例：**
```
套利机会：BTC 在 OKX 买入 $84,200，在 Binance 卖出 $84,650，净利润 0.33%
```

**重要说明：**
- 仅提醒，不自动交易
- 使用 ask/bid 价格（非 last）确保更贴近实际可执行价
- 注册 `arbitrageScanner.onAlert(callback)` 接收告警

### 3.10 资金费率监控

**启动费率监控：**
```
fundingRateMonitor.start(getPassword)   // 启动（5 分钟轮询）
fundingRateMonitor.stop()               // 停止
```

**配置监控：**
```
fundingRateMonitor.updateConfig({
  symbols: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
  exchanges: ['binance', 'okx', 'bybit'],
  annualizedThreshold: 30    // 年化超过 30% 时告警
})
fundingRateMonitor.addSymbol('SOL/USDT:USDT')    // 添加
fundingRateMonitor.removeSymbol('ETH/USDT:USDT') // 移除
```

**查询当前费率：**
```
const rates = await fundingRateMonitor.fetchCurrentRates(masterPassword)
```

**手动扫描套利机会：**
```
const opportunities = await fundingRateMonitor.scanNow(masterPassword)
```

**显示格式示例：**
```
BTC/USDT:USDT (Binance)
当前费率: 0.0350% (每 8h)
年化: 38.3%
方向: 正费率 → 建议做空收取费率
下次结算: 2 小时 15 分钟后
```

**重要说明：**
- 仅提醒，不自动交易
- 永续合约符号格式为 `BTC/USDT:USDT`（CCXT 标准）
- 正费率 → 多头付给空头，建议做空收取；负费率 → 反之
- 注册 `fundingRateMonitor.onAlert(callback)` 接收告警

### 3.11 条件单/计划委托

**创建条件单：**
```
调用 conditionalOrderManager.createOrder({
  name: 'BTC 跌到 80000 买入',
  exchangeId: 'binance',
  symbol: 'BTC/USDT',
  condition: {
    type: 'price_below',       // 'price_above' | 'price_below' | 'price_change_up' | 'price_change_down'
    targetPrice: 80000         // price_above/below 用
  },
  order: {
    side: 'buy',
    type: 'market',
    amount: 0.01,
    market: 'spot'
  },
  triggerMode: 'once',         // 'once' 一次性 | 'recurring' 持续触发
  cooldownMs: 60000,           // recurring 模式下触发间冷却 (ms)
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000  // 可选：7天后过期
})
```

**价格变动条件单：**
```
调用 conditionalOrderManager.createOrder({
  name: 'ETH 涨幅超 5% 卖出',
  exchangeId: 'okx',
  symbol: 'ETH/USDT',
  condition: {
    type: 'price_change_up',
    changePercent: 5,
    basePrice: 3200            // 基准价格
  },
  order: {
    side: 'sell',
    type: 'market',
    amount: 1,
    market: 'spot'
  }
})
```

**管理条件单：**
```
conditionalOrderManager.listOrders()                    // 列出所有条件单
conditionalOrderManager.cancelOrder(orderId)             // 取消
conditionalOrderManager.pauseOrder(orderId)              // 暂停
conditionalOrderManager.resumeOrder(orderId)             // 恢复
conditionalOrderManager.getExecutionHistory(orderId, 20) // 执行历史
```

**启动/停止：**
```
conditionalOrderManager.start(getPassword)  // 启动（15s 轮询检查价格）
conditionalOrderManager.stop()              // 停止
```

**重要说明：**
- 条件单在创建时即视为用户已授权自动执行
- 触发后通过 previewOrder → executeOrder 流程下单，风控仍然生效
- once 模式触发后自动变为 triggered 状态；recurring 模式会在冷却期后继续监控
- 注册 `conditionalOrderManager.onEvent(callback)` 接收触发/过期通知

### 3.12 异常检测告警

**启动/停止异常检测：**
```
anomalyDetector.start(getPassword)   // 启动（60s 轮询）
anomalyDetector.stop()               // 停止
```

**配置异常检测：**
```
anomalyDetector.updateConfig({
  enabled: true,
  balanceDropThresholdPercent: 10,    // 余额下降超过 10% 触发 critical 告警
  balanceCheckWindowMs: 300000,       // 5 分钟窗口
  apiFailureThreshold: 5,            // API 连续失败 5 次触发告警
  cooldownMs: 1800000,               // 同一异常 30 分钟冷却
  pollingMs: 60000                   // 60 秒轮询
})
```

**检测类型：**
- `balance_drop`（critical）：短时间内总资产下降超过阈值，定位具体交易所
- `unknown_order`（warning）：某交易所短时间内出现大量成交订单
- `api_failure`（warning）：某交易所 API 连续失败超过阈值

**告警格式示例：**
```
异常告警：总资产在 5 分钟内下降 12.3%（$58,030 → $50,893）
详情：binance: -15.2% ($45,230 → $38,350)
```

**重要说明：**
- 余额快照持久化保存（最近 100 条），重启后不丢失历史数据
- 注册 `anomalyDetector.onAlert(callback)` 接收告警

### 3.13 安全报告

**手动生成安全报告：**
```
const report = await securityReporter.generateReport(masterPassword)
```

**启动自动报告（每 24 小时）：**
```
securityReporter.start(getPassword)   // 启动
securityReporter.stop()               // 停止
```

**获取上次报告：**
```
securityReporter.getLastReport()
```

**配置：**
```
securityReporter.updateConfig({
  pollingMs: 86400000,                // 24 小时生成一次
  keyRotationWarningDays: 90,         // 超过 90 天建议轮换
  keyRotationCriticalDays: 180        // 超过 180 天强烈建议轮换
})
```

**安全检查项目（每个交易所满分 100 分）：**

| 检查项 | pass | warning | fail |
|--------|------|---------|------|
| API Key 年龄 | <90天 (25分) | 90-180天 (15分) | >180天 (5分) |
| 提现权限 | 无提现 (25分) | — | 有提现 (0分) |
| IP 白名单 | 已设置 (25分) | 未设置 (10分) | — |
| API 连接状态 | 正常 (25分) | — | 连接失败 (0分) |

**报告格式示例：**
```
安全评分 85/100 — 状态良好。共检查 2 个交易所 API Key。
建议：
  - binance: Key 已使用 95 天，建议轮换（超过 90 天）
  - okx: 未设置 IP 白名单，建议在交易所后台配置
```

**重要说明：**
- 注册 `securityReporter.onReport(callback)` 接收报告生成通知

## 4. Risk & Safety

- 所有 API Key 使用 AES-256-GCM 加密，存储在本地 `~/.openclaw/skills/cex-trading/vault/`
- 拒绝存储含提现权限的 API Key
- 所有交易必须经过风控检查和用户二次确认
- 风控规则可由用户自定义（单笔限额、日限额、最大杠杆等）
- 大额交易和合约交易会触发额外警告
- 所有操作日志中 API Key 自动脱敏

## 5. Data Storage

```
~/.openclaw/skills/cex-trading/
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

## 6. Supported Exchanges

binance, okx, bybit, gateio, bitget, coinbase, kucoin, htx, mexc, cryptocom
（基于 CCXT 库，理论上支持 100+ 家交易所）
