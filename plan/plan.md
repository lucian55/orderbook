# OrderBook 组件实施计划

## 技术栈

- **框架**: Next.js (App Router) + TypeScript
- **样式**: Tailwind CSS v4（动画在 `globals.css` 中用 `@keyframes` + 直接 class 定义）
- **WebSocket**: 泛型基类 `BtseWsClient<T>` + 单例子类，多 handler 分发
- **HTTP 查询 / 轮询兜底**: `@tanstack/react-query`
- **单元 / 集成测试**: Vitest + jsdom + React Testing Library
- **E2E**: Playwright（mock WebSocket 不依赖真实服务）
- **代码风格**: ESLint + Prettier + Husky + lint-staged（pre-commit 自动修复）

---

## 最终效果图说明

```
┌─────────────────────────────────────────────┐
│  Order Book      Group [0.1▼]  [状态指示] │  ← Tick 下拉 + WsIndicator
├──────────────┬────────┬─────────┬───────────┤
│ Price (USD)  │  Size  │  Total  │           │  ← 表头
├─────────────────────────────────────────────┤
│  21,699.0    │  3,691 │  5,657  │           │  ← sell 行（红色价格）×8
├─────────────────────────────────────────────┤
│        21,657.5 ↑                           │  ← Last Price
├─────────────────────────────────────────────┤
│  21,664.5    │   591  │    591  │           │  ← buy 行（绿色价格）×8
└─────────────────────────────────────────────┘
```

关键细节：
- Sell 区：价格**降序**（最高价在顶，最低价靠近 LastPrice），红色价格
- Buy 区：价格**降序**（最高价靠近 LastPrice，最低价在底），绿色价格
- 累计百分比条：绝对定位贴右侧，宽度 = `totalPercent * 100%`
- 行高固定 `ITEM_HEIGHT = 28px`，每侧容器高度固定 = `28 * 8 = 224px`
- WS snapshot 含约 50 档，固定展示最靠近 LastPrice 的 8 档
- 浏览器 tab title 实时同步：`↑ 21,657.5 BTCPFC`

---

## 项目结构

按 **feature-folder + shared 基础设施 + 顶级 api 数据访问层** 组织：

```
├── app/                                # Next.js 路由装配，不放业务
│   ├── layout.tsx
│   ├── page.tsx                        # dynamic import OrderBook（ssr: false）
│   ├── providers.tsx                   # QueryClientProvider
│   └── globals.css                     # Tailwind + 闪烁动画 + reduced-motion
├── api/                                # 外部数据访问层（顶级，跨 feature 共享）
│   └── btse.ts                         # BTSE REST 封装 + RestOrderBookSnapshot 类型
├── features/                           # 业务域
│   └── orderbook/
│       ├── index.ts                    # barrel：对外只暴露 OrderBook 主组件
│       ├── components/                 # OrderBook / SideList / LastPrice / Header
│       │                               # LoadingSkeleton / WsIndicator
│       │                               # TickSizeSelector / ErrorBoundary
│       ├── hooks/
│       │   ├── useOrderBook.ts
│       │   └── useLastPrice.ts
│       ├── websocket/
│       │   ├── BtseOrderBookClient.ts  # 盘口单例（BTCPFC 业务配置）
│       │   └── BtseLastPriceClient.ts  # 成交价单例
│       ├── utils/
│       │   └── orderBookUtils.ts
│       ├── types.ts                    # Quote / OrderBookMessage / SIDE 等
│       └── constants.ts                # MAX_VISIBLE_QUOTES / TICK_SIZE_OPTIONS
├── shared/                             # 通用基础设施
│   ├── hooks/
│   │   ├── useAnimationQueue.ts
│   │   └── useDocumentTitle.ts
│   ├── utils/
│   │   └── formatNumber.ts
│   └── websocket/
│       └── BtseWsClient.ts             # 通用 WS 泛型基类
├── test/                               # Vitest 单元 + 集成测试
└── e2e/                                # Playwright
```

### 导入约定

- **feature 内部** 互相引用用相对路径（`../types`、`./SideList`），让 feature 整个文件夹可独立移植
- **跨 feature/shared/api** 用绝对路径 `@/...`，跨层依赖一眼可见
- **依赖方向**：`app → features → shared`；`features → api`；`shared` 与 `api` 不依赖 features
  - 例外：BTSE REST 接口的返回类型 `RestOrderBookSnapshot` 内联在 `api/btse.ts` 自身，避免 api 反向依赖 features/types

---

## 阶段一：类型定义与工具函数

### 1.1 类型定义 (`types/orderBook.ts`)

用 const 对象替代魔术字符串，类型由 const 派生：

```
SIDE       = { BUY: 'buy', SELL: 'sell' }
WS_STATUS  = { CONNECTING, HEALTHY, TIMEOUT, FAILED }
MSG_TYPE   = { SNAPSHOT, DELTA }

type Side / WsHealthStatus / OrderBookMessageType
```

关键接口：`Quote`、`OrderBookMessage`、`TradeHistoryMessage`、`RestOrderBookSnapshot`。

注意：WS 消息的 `type`/`seqNum` 在 **`data` 内部**，不在消息顶层。

### 1.2 工具函数 (`utils/orderBookUtils.ts`)

- `applyDelta(book, delta)` — size=0 删除，返回新 Map
- `aggregateByTick(book, tickSize, side)` — 按 tick 聚合：buy 向下取整 / sell 向上取整（避免聚合后显示出比真实更优的价格），同桶 size 累加
- `computeQuotes(book, side, tickSize=0)` — 可选先聚合，再降序排列 + 累计 total；buy 从高到低累计、sell 从低到高；maxTotal 直接取首/尾元素 O(1)
- `visibleQuotesEqual(prev, next, side)` — 比较可见 8 档的 price/size/totalPercent，用于跳过无变化的 setState

### 1.3 工具函数 (`utils/formatNumber.ts`)

- `formatWithCommas(num)` — 千位分隔
- `formatPrice(price, decimals=1)` — 固定小数位 + 千分位，保证列对齐
- `tickDecimals(tick)` — 根据 tick 推导显示小数位（0.1→1，1→0），让 UI 精度与聚合粒度对齐

### 1.4 共享常量 (`page/orderBook/constants.ts`)

- `MAX_VISIBLE_QUOTES = 8`，hook 与 SideList 共用
- `TICK_SIZE_OPTIONS = [0.1, 0.5, 1]` — 大 tick 因 BTSE 只推 ~50 档会出现空行，故只保留实际有意义的档位
- `DEFAULT_TICK_SIZE = 0.1`

### 1.5 单元测试覆盖

**`applyDelta`**：新增 / 更新 / size=0 删除 / 不变更原 Map / 批量变更

**`aggregateByTick`**：tickSize≤0 直通；buy 向下取整 + 同桶累加；sell 向上取整；浮点 tick（0.5）；不变更原 Map

**`computeQuotes`**：降序排列；过滤 size≤0；buy / sell 各自的 total 累加方向与 totalPercent=1 的位置；与 tickSize 组合使用

**`visibleQuotesEqual`**：price / size / totalPercent 任一不同返回 false；buy 只比前 8、sell 只比后 8

---

## 阶段二：BTSE REST API 封装

两个接口，均兜底数组格式（`Array.isArray(json) ? json[0] : json`）：

- `fetchOrderBook()` — `GET /orderbook?symbol=BTCPFC&depth=50`
- `fetchLastPrice()` — `GET /price?symbol=BTCPFC`

---

## 阶段三：WebSocket 层

### BTSE 协议要点

- 订阅：`{ op: 'subscribe', args: ['update:BTCPFC'] }`
- 盘口消息：`{ topic, data: { type: 'snapshot'|'delta', seqNum, prevSeqNum, bids, asks } }`
- 心跳：服务端 ~9s 无消息断开；客户端 5s 主动 ping；服务端也会推 `{ event: 'ping' }` 需回 pong
- LastPrice 订阅：`tradeHistoryApi:BTCPFC`；服务端回包 topic 为 `tradeHistoryApi`（不带交易对）

### 3.1 `BtseWsClient<T>`（泛型基类）

封装连接/心跳/重连/分发，业务层只需提供 `parseMessage`：

```
subscribe(handler)  → 取消订阅函数，首次调用自动建立连接
resubscribe()       → 强制重连：解绑旧 onclose 后 close()，立即 connect()
close()             → 主动关闭
```

重连策略：`onclose` 非主动关闭时自动重连，间隔 3s，最多 10 次。

**关键陷阱**：`resubscribe` 中必须先把 `ws.onclose = null` 再 `close()`，否则旧 ws 的异步 onclose 回调会读到已被重置的 `isManualClose=false`，触发多余的 `scheduleReconnect`。

### 3.2 `BtseOrderBookClient` / `BtseLastPriceClient`

均为薄包装：传入 config 创建 `BtseWsClient<T>` 实例，工厂函数单例暴露。
`parseMessage` 过滤无关消息（盘口过滤 snapshot/delta，成交价过滤 topic + data 非空）。

---

## 阶段四：`useOrderBook` hook

### 4.1 核心状态与 Ref 设计

```
// 入参
tickSize: TickSize = 0.1

// React state
bids, asks: Quote[]
isLoading: boolean
wsStatus: WsHealthStatus

// WS 回调专用 Ref（不触发重渲染）
bidsMapRef, asksMapRef: Map<number, number>
lastSeqNumRef: number
lastMsgTimeRef: number
lastResubscribeTimeRef: number
tickSizeRef: TickSize                          // 跨闭包读取最新 tick

// state 同步镜像（flushToState 读当前值）
bidsStateRef, asksStateRef: Quote[]
wsStatusRef: WsHealthStatus
prevBidsRef, prevAsksRef: Quote[]              // 动画 diff

timerRef: number | null                        // 节流定时器
```

### 4.2 需求①：页面获得焦点后刷新

监听 `visibilitychange`：`visible` 时 `safeResubscribe()` + `invalidateQueries()`。
`useQueryClient()` 获取实例（防止 SSR 多实例）。

### 4.3 需求②：30s 无消息认为断开

`setInterval` 每 10s 检查 `lastMsgTimeRef`，超时 `setWsStatus(TIMEOUT)` + `safeResubscribe()`。

`safeResubscribe`：5s 冷却，所有重连入口统一经过。

### 4.4 需求③：节流渲染 + 时序正确

**`flushToState(fromSnapshot = false)`** 核心约束：

```
function flushToState(fromSnapshot):
  tick = tickSizeRef.current
  newBids = computeQuotes(bidsMapRef, 'buy',  tick)
  newAsks = computeQuotes(asksMapRef, 'sell', tick)

  if not fromSnapshot and 可见区无变化: return

  if fromSnapshot:
    prevBidsRef = prevAsksRef = []
  else:
    prevBidsRef = bidsStateRef       # 先存 prev 再更新——顺序固定
    prevAsksRef = asksStateRef

  bidsStateRef = newBids
  asksStateRef = newAsks
  setBids(newBids); setAsks(newAsks)
```

**`scheduleFlush`**：150ms 节流，略大于 FLASH_DURATION（100ms），保证动画播放完整。

### 4.5 需求④：WS 故障 REST 兜底

`refetchInterval`：`wsStatus ∈ {TIMEOUT, FAILED} ? 3000 : false`。
REST 数据到达时检查 `wsStatus` 仍为故障态才写入，避免覆盖恢复后的 snapshot。

### 4.6 需求⑤：网络断线 / 切回 tab

监听 `online` + `visibilitychange`，均走 `safeResubscribe()` + `invalidateQueries()`。

### 4.7 需求⑥：Tick size 动态聚合

```
useLayoutEffect(() => {
  if (Map 为空) return                # 首次挂载守卫
  flushToState(true)                  # 用新 tick 重新计算 + 清 prev 不闪
}, [tickSize])
```

**为什么 useLayoutEffect 不是 useEffect**：tickSize 切换时 OrderBookInner 立即用新 priceDecimals 渲染。若 flush 异步执行，会有一帧"旧 quotes 用新小数位"——75000.3 / 75000.5 都显示为 75,000、出现重复行。layout effect 在 paint 前同步完成。

### 4.8 WS 消息处理流程

```
消息到达
    ├─ 更新 lastMsgTimeRef
    ├─ snapshot
    │   ├─ 重建 bidsMapRef / asksMapRef（过滤 size=0）
    │   ├─ 更新 lastSeqNumRef
    │   ├─ setIsLoading(false); setWsStatus(HEALTHY)
    │   └─ flushToState(true)  ← 不触发动画
    └─ delta
        ├─ prevSeqNum 与 lastSeqNumRef 不匹配 → safeResubscribe()
        ├─ applyDelta(bids/asksMapRef, delta)
        └─ scheduleFlush()
```

---

## 阶段五：`useLastPrice` hook

返回 `{ lastPrice, prevLastPrice }`。

- WS 取 `data[0].price`
- RAF 节流：同帧多条消息只保留最后一条；`lastPriceRef` 相同值不 setState
- 30s 无消息：`setRestEnabled(true)` + `safeResubscribe()`
- visibilitychange / online：与 `useOrderBook` 对齐，主动 `safeResubscribe` + `invalidateQueries`
- REST 兜底：`refetchInterval: restEnabled ? 3000 : false`

---

## 阶段六：动画与 SideList

### 6.1 `useAnimationQueue` hook

从 SideList 中抽出，独立可测：

```
processNext():
  if queue empty: timerRef = null; return
  price = queue.shift()
  flashSet.add(price)
  setTimeout(100ms, () => flashSet.delete(price))   # FLASH_DURATION
  timerRef = setTimeout(80ms, processNext)          # DEQUEUE_INTERVAL
```

`enqueue(prices)` 入队，timer 空闲时立即拉起 `processNext`。卸载时清理所有 timer。

### 6.2 `SideList.tsx`

固定展示 8 档，无虚拟滚动。

- 数据截取：buy 取前 8，sell 取后 8
- prev 同样截取，避免"第 9 位升入前 8"被误判为新价格
- **`useDeferredValue(prevQuotes)`**：动画对比是非紧急派生工作，降为低优先级渲染，让数据显示优先呈现
- 价格小数位由 `tickDecimals(tickSize)` 决定
- 行结构：百分比条（abs right）+ 价格（flex-1）+ Size（w-24）+ Total（w-24）
- Size flash：Size span 的 `key={price_size}`，size 变化时 React 重挂载触发动画
- `React.memo` 包裹：LastPrice 更新时不连累 SideList 内部正在播放的动画

---

## 阶段七：UI 组件

### 7.1 `Header.tsx`

静态表头：Price (USD) / Size / Total。

### 7.2 `LastPrice.tsx`

根据涨/跌/平切换颜色背景与箭头；`lastPrice === null` 显示 `--` 占位。
`aria-live="polite"` + `aria-atomic="true"` + 完整 `aria-label`。

### 7.3 `WsIndicator.tsx`

仅在 `TIMEOUT` / `FAILED` 时显示（healthy/connecting 返回 null）。
彩色圆点 + 状态文字。

### 7.4 `LoadingSkeleton.tsx`

N 个 28px 高的占位 `<li>`，模拟数字宽度，避免布局跳动。

### 7.5 `TickSizeSelector.tsx`

原生 `<select>`，无障碍由浏览器原生支持，`aria-label="Aggregation tick size"`。

### 7.6 `ErrorBoundary.tsx`

class 组件 + `getDerivedStateFromError`，子树抛错时显示降级 UI 而非白屏。

### 7.7 `OrderBook/index.tsx`

```tsx
<ErrorBoundary>
  <OrderBookInner />  // 内部 useState<TickSize> + useOrderBook(tickSize)
</ErrorBoundary>
```

三种渲染状态：

```
isError = (wsStatus FAILED|TIMEOUT) && bids/asks 都空 && !isLoading

isLoading → Header + Skeleton×8 + LastPrice(null) + Skeleton×8
isError   → 错误提示
正常      → Header + SideList(sell) + LastPrice + SideList(buy)
```

最外层容器 `role="region"` + `aria-label="Order Book"`。
标题栏右侧：`<TickSizeSelector>` + `<WsIndicator>`。
浏览器 tab title 通过 `useDocumentTitle` 同步：`↑ 21,657.5 BTCPFC`。

### 7.8 `useDocumentTitle` hook

通用 hook：`useEffect` 更新 `document.title`，`originalRef` 在挂载时记录原始 title，卸载时恢复，防止副作用泄漏到其他页面。

### 7.9 `page.tsx` / `layout.tsx` / `providers.tsx`

- `page.tsx`：`dynamic(() => import('@/page/orderBook'), { ssr: false })`
- `providers.tsx`：`useState(() => new QueryClient(...))` 防止 SSR 多实例
- `layout.tsx`：包裹 `<Providers>`

---

## 阶段八：动画与无障碍（`globals.css`）

```css
@keyframes flash-green { from { bg: rgba(0,177,93,0.5) } to { bg: transparent } }
@keyframes flash-red   { from { bg: rgba(255,91,90,0.5) } to { bg: transparent } }

.animate-flash-green { animation: flash-green 0.1s ease-out forwards; }
.animate-flash-red   { animation: flash-red   0.1s ease-out forwards; }

/* 尊重系统的"减少动态效果"偏好：关闭闪烁，数据更新照常 */
@media (prefers-reduced-motion: reduce) {
  .animate-flash-green, .animate-flash-red { animation: none; }
}
```

直接 class 定义（不用 Tailwind v4 `@utility`），动画类不需要扫描就能用。
动画时长 `0.1s` 与 `FLASH_DURATION = 100ms` 保持一致。

---

## 阶段九：性能优化

| 优化项 | 实现方式 |
|--------|---------|
| 150ms 节流渲染 | `scheduleFlush` + `setTimeout`，高频 delta 合批 |
| 跳过无效 render | `visibleQuotesEqual` 比较可见 8 档，无变化时不调 setState |
| SideList memo | `React.memo(SideList)` 防止 LastPrice 更新截断行动画 |
| useDeferredValue | `prevQuotes` 降为低优先级渲染，动画对比让步给主路径 |
| 函数引用稳定 | `useCallback` / `useRef` 保存函数，避免 effect 重跑 |
| WS 回调只读 Ref | 闭包不依赖 state，避免过期 |
| Map in-place 更新 | `applyDelta` 返回新 Map，避免重建数组 |
| O(1) maxTotal | 累加方向固定，直接取首/尾元素 |
| LayoutEffect 切 tick | 避免一帧"旧数据+新精度"的视觉错位 |

---

## 阶段十：测试

### 10.1 单元 / 集成（Vitest + RTL + jsdom）

- `test/orderBookUtils.test.ts` — 纯函数全覆盖
- `test/useAnimationQueue.test.ts` — fake timers 验证队列时序与卸载清理
- `test/useOrderBook.test.tsx` — mock WS client + QueryClient：snapshot / delta / seqNum 断层重订阅 / 5s 冷却 / 150ms 节流合批 / tickSize 切换重聚合

### 10.2 E2E（Playwright）

`page.addInitScript` 替换 `window.WebSocket` 为可控实现，测试通过 `__mockWs._emit` 注入消息。
覆盖：首屏渲染、document.title 同步、tick 切换价格精度变化。

### 10.3 代码风格

- ESLint（`eslint-config-next`）
- Prettier
- Husky pre-commit → lint-staged → `eslint --fix` + `prettier --write`

---

## 健壮性需求汇总

| # | 需求 | 实现位置 | 核心机制 |
|---|------|---------|---------|
| 1 | 后台获得焦点刷新 | §4.2 / §5 | `visibilitychange` → `safeResubscribe` + `invalidateQueries` |
| 2 | 30s 无消息重连 | §4.3 / §5 | `setInterval` 检测 `lastMsgTimeRef` |
| 3 | WS 推送太快体感无感 | §4.4 | `scheduleFlush` 150ms 节流 |
| 4 | WS 故障轮询兜底 | §4.5 / §5 | `useQuery` + `refetchInterval` 由 `wsStatus` / `restEnabled` 控制 |
| 5 | resubscribe 防无限循环 | §4.3 | `safeResubscribe` 5s 冷却，统一入口 |
| 6 | prev 更新时序错误导致动画失效 | §4.4 | 先存 prev 再 setBids |
| 7 | snapshot 触发全量行动画 | §4.4 / §6.1 | `flushToState(true)` 清 prev；`prevSet.size=0` 不入队 |
| 8 | WS 恢复后 REST 覆盖新 snapshot | §4.5 | REST useEffect 中 `wsStatus !== TIMEOUT/FAILED` 时丢弃 |
| 9 | 断网重连未刷新 | §4.6 / §5 | `online` 事件统一入口 |
| 10 | 初始加载无骨架屏 | §7.7 | `isLoading` 控制 |
| 11 | WS + REST 双失败无错误提示 | §7.7 | `isError` 含 `!isLoading` 条件渲染 |
| 12 | Next.js QueryClient 多实例 | §7.9 | `useState(() => new QueryClient())` |
| 13 | resubscribe 旧 onclose 误触发重连 | §3.1 | close 前先解绑 onclose / onerror / onmessage |
| 14 | tick 切换有一帧错位 | §4.7 | `useLayoutEffect` 同步 flush |
| 15 | 子树抛错白屏 | §7.6 | `ErrorBoundary` 包裹 OrderBookInner |
| 16 | 前庭功能障碍用户被闪烁干扰 | §8 | `prefers-reduced-motion` 关闭动画 |
| 17 | 屏幕阅读器不可用 | §7.2 / §7.7 | `role="region"` + `aria-live` + `aria-label` |
| 18 | document.title 副作用残留 | §7.8 | 卸载时还原原始 title |

---

## 实施顺序

| 步骤 | 内容 |
|------|------|
| 1  | `types/orderBook.ts` + `constants.ts` + `utils/`（含 `aggregateByTick` / `formatPrice`） |
| 2  | 工具函数单元测试（`orderBookUtils.test.ts`） |
| 3  | `api/btse.ts` |
| 4  | `providers.tsx` + `layout.tsx` |
| 5  | `BtseWsClient` + 两个单例（含 resubscribe 解绑陷阱） |
| 6  | `useOrderBook` 基础版（WS 订阅 + seqNum 校验 + isLoading） |
| 7  | `safeResubscribe` 冷却 + 30s 超时检测 |
| 8  | `visibilitychange` + `online` 事件 |
| 9  | 150ms 节流 + `flushToState` 时序 + `visibleQuotesEqual` + `fromSnapshot` |
| 10 | react-query 兜底 + WS 恢复优先级 |
| 11 | `useLastPrice`（含 visibility/online 对齐） |
| 12 | `useAnimationQueue` 抽出 + 单测 |
| 13 | Tailwind v4 动画 + `prefers-reduced-motion` |
| 14 | `SideList`（固定 8 行 + useDeferredValue + 动画 hook） |
| 15 | `Header` / `LastPrice` / `LoadingSkeleton` / `WsIndicator` |
| 16 | `TickSizeSelector` + `useOrderBook(tickSize)` + `useLayoutEffect` |
| 17 | `ErrorBoundary` + 主容器装配 + aria |
| 18 | `useDocumentTitle` + 接入主容器 |
| 19 | `page.tsx` dynamic import |
| 20 | `useOrderBook` / `useAnimationQueue` 集成测试 |
| 21 | Playwright E2E（mock WS + tick 切换 + title） |
| 22 | Prettier / Husky / lint-staged |
| 23 | README + 架构图 |

---

## 样式速查

| 用途 | Tailwind class |
|------|----------------|
| 页面 / 组件背景 | `bg-[#131B29]` |
| 默认文字 | `text-[#F0F4F8]` |
| 表头文字 | `text-[#8698aa]` |
| Buy 价格 | `text-[#00b15d]` |
| Sell 价格 | `text-[#FF5B5A]` |
| 行 hover 背景 | `hover:bg-[#1E3059]` |
| Buy 累计条 | `bg-[rgba(16,186,104,0.12)]` |
| Sell 累计条 | `bg-[rgba(255,90,90,0.12)]` |
| Flash green | `animate-flash-green` |
| Flash red | `animate-flash-red` |
