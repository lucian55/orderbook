// ─── 业务常量 ────────────────────────────────────────────────────────────────

/** 买卖方向 */
export const SIDE = {
  BUY:  'buy'  as const,
  SELL: 'sell' as const,
}

/** WebSocket 连接健康状态 */
export const WS_STATUS = {
  CONNECTING: 'connecting' as const,
  HEALTHY:    'healthy'    as const,
  TIMEOUT:    'timeout'    as const,
  FAILED:     'failed'     as const,
}

/** 盘口消息类型 */
export const MSG_TYPE = {
  SNAPSHOT: 'snapshot' as const,
  DELTA:    'delta'    as const,
}

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type Side = typeof SIDE[keyof typeof SIDE]
export type WsHealthStatus = typeof WS_STATUS[keyof typeof WS_STATUS]
export type OrderBookMessageType = typeof MSG_TYPE[keyof typeof MSG_TYPE]

/** 单条报价，带累计量和百分比，用于渲染列表行 */
export interface Quote {
  price: number
  size: number
  total: number        // 从最佳价格起的累计量
  totalPercent: number // total / 全档位最大 total，用于百分比条宽度
}

/** WS 推送的盘口消息体 */
export interface OrderBookData {
  type: OrderBookMessageType
  seqNum: number      // 当前消息序号
  prevSeqNum: number  // 期望的上一条序号，用于校验连续性
  symbol: string
  bids: [string, string][]  // [price, size] 字符串对
  asks: [string, string][]
}

export interface OrderBookMessage {
  topic: string
  data: OrderBookData
}

/** 成交历史单条记录 */
export interface TradeEntry {
  price: number
  size: number
  side: string
  symbol: string
  tradeId: number
  timestamp: number
}

export interface TradeHistoryMessage {
  topic: string
  data: TradeEntry[]
}
