// 相对路径，由 next.config.ts 的 rewrites 代理到 https://api.btse.com/futures/api/v2.1
// 绕开 BTSE 对浏览器直连的 403（CORS / Cloudflare 拦截）
const BASE = '/btse-api'

/** BTSE REST 盘口接口返回结构（与 WS snapshot 格式不同，size/price 均为字符串） */
export interface RestOrderBookSnapshot {
  buyQuote: Array<{ price: string; size: string }>
  sellQuote: Array<{ price: string; size: string }>
}

/**
 * 获取 BTCPFC 盘口快照（50 档），用于 WS 超时时的 REST 兜底。
 * 返回格式统一为 { buyQuote, sellQuote }。
 */
export async function fetchOrderBook(): Promise<RestOrderBookSnapshot> {
  const res = await fetch(`${BASE}/orderbook?symbol=BTCPFC&depth=50`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`OrderBook fetch failed: ${res.status}`)
  const json = await res.json()
  // BTSE 接口返回数组，取第一个元素
  const data = Array.isArray(json) ? json[0] : json
  return {
    buyQuote: data.buyQuote ?? [],
    sellQuote: data.sellQuote ?? [],
  }
}

/**
 * 获取 BTCPFC 最新成交价，用于 lastPrice WS 超时时的 REST 兜底。
 */
export async function fetchLastPrice(): Promise<number> {
  const res = await fetch(`${BASE}/price?symbol=BTCPFC`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`LastPrice fetch failed: ${res.status}`)
  const json = await res.json()
  const data = Array.isArray(json) ? json[0] : json
  return data.lastPrice as number
}
