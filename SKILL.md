---
name: cex-trading
description: 中心化交易所交易与资产管理。通过自然语言在 Binance、OKX、Bybit 等 100+ 交易所下单交易，监控账户余额，追踪损益。
version: 0.1.0
author: chainclaw
permissions:
  - filesystem
  - network
tags:
  - crypto
  - trading
  - exchange
  - portfolio
  - defi
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
- 用户提到"交易"、"下单"、"买入"、"卖出"、"余额"、"持仓"、"资产"、"盈亏"等关键词

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
└── risk-rules.json           # 风控规则配置
```

## 6. Supported Exchanges

binance, okx, bybit, gateio, bitget, coinbase, kucoin, htx, mexc, cryptocom
（基于 CCXT 库，理论上支持 100+ 家交易所）
