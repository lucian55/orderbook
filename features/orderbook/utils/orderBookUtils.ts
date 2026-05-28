import { Quote, Side, SIDE } from '../types'
import { MAX_VISIBLE_QUOTES } from '../constants'

/**
 * 按 tick 将原始价位聚合到更粗粒度的价位上。
 *
 * 取整方向遵循"对该侧用户更不利"原则，避免聚合后显示出比真实更优的价格：
 *   - buy（用户出价）：向下取整 — 75000.3 在 tick=1 时归到 75000
 *   - sell（用户接受价）：向上取整 — 75000.3 在 tick=1 时归到 75001
 *
 * 同一桶内 size 累加。tickSize <= 0 时直接返回原 Map。
 */
export function aggregateByTick(
  book: Map<number, number>,
  tickSize: number,
  side: Side
): Map<number, number> {
  if (!(tickSize > 0)) return book
  const result = new Map<number, number>()
  for (const [price, size] of book) {
    // 浮点除法会产生噪声（如 73540.7/0.1 = 735406.9999999999），
    // 若直接 floor/ceil 会把整 tick 价格错配到相邻桶。先把 factor 校正回整数。
    const factor = Math.round((price / tickSize) * 1e8) / 1e8
    const bucketRaw =
      side === SIDE.BUY ? Math.floor(factor) * tickSize : Math.ceil(factor) * tickSize
    // 浮点累计误差校正：tick 通常为 0.1/0.5/1/5，1e8 精度足够覆盖
    const key = Math.round(bucketRaw * 1e8) / 1e8
    result.set(key, (result.get(key) ?? 0) + size)
  }
  return result
}

/**
 * 判断两个 Quote 数组的可见部分是否完全相同。
 * 用于在 flushToState 中跳过无视觉变化的 setState，减少不必要的 re-render。
 *
 * 比较字段：price、size、totalPercent（三者任一变化均需重新渲染）。
 * totalPercent 会受深层档位影响（maxTotal 变化），所以必须纳入比较。
 */
export function visibleQuotesEqual(prev: Quote[], next: Quote[], side: Side): boolean {
  const n = MAX_VISIBLE_QUOTES
  const prevVis = side === SIDE.BUY ? prev.slice(0, n) : prev.slice(-n)
  const nextVis = side === SIDE.BUY ? next.slice(0, n) : next.slice(-n)
  if (prevVis.length !== nextVis.length) return false
  for (let i = 0; i < prevVis.length; i++) {
    const p = prevVis[i],
      q = nextVis[i]
    if (p.price !== q.price || p.size !== q.size || p.totalPercent !== q.totalPercent) {
      return false
    }
  }
  return true
}

/**
 * 将增量 delta 应用到当前盘口 Map 上，返回新 Map。
 * size === 0 表示该价位被删除。
 */
export function applyDelta(
  book: Map<number, number>,
  delta: [string, string][]
): Map<number, number> {
  const next = new Map(book)
  for (const [priceStr, sizeStr] of delta) {
    const price = parseFloat(priceStr)
    const size = parseFloat(sizeStr)
    if (size === 0) {
      next.delete(price)
    } else {
      next.set(price, size)
    }
  }
  return next
}

/**
 * 将原始 Map 转换为带累计 total 和百分比 totalPercent 的 Quote 数组。
 * 结果始终按价格降序排列（index 0 = 最高价）。
 *
 * total 累计方向：
 *   - buy：从高到低（index 0 开始），末尾元素 total 最大
 *   - sell：从低到高（index length-1 开始），首位元素 total 最大
 *
 * totalPercent = 当前 total / maxTotal，用于绘制百分比条。
 */
export function computeQuotes(book: Map<number, number>, side: Side, tickSize = 0): Quote[] {
  // tickSize > 0 时先按 tick 聚合，再计算累计量
  const source = tickSize > 0 ? aggregateByTick(book, tickSize, side) : book
  // 过滤掉 size <= 0 的异常档位，统一降序排列
  const entries = Array.from(source.entries())
    .filter(([, size]) => size > 0)
    .sort((a, b) => b[0] - a[0])

  const result: Quote[] = entries.map(([price, size]) => ({
    price,
    size,
    total: 0,
    totalPercent: 0,
  }))

  let runningTotal = 0

  if (side === SIDE.BUY) {
    // 买盘：从 index 0（最高买价）向下累加，末尾 total 最大
    for (const q of result) {
      runningTotal += q.size
      q.total = runningTotal
    }
  } else {
    // 卖盘：从 index length-1（最低卖价）向上累加，首位 total 最大
    for (let i = result.length - 1; i >= 0; i--) {
      runningTotal += result[i].size
      result[i].total = runningTotal
    }
  }

  // 累加结束后 maxTotal 位置固定：买盘在末尾，卖盘在首位
  // 直接读取而非 Math.max(…map)，O(1) vs O(n)
  const maxTotal =
    result.length > 0 ? (side === SIDE.BUY ? result[result.length - 1].total : result[0].total) : 0

  for (const q of result) {
    q.totalPercent = maxTotal > 0 ? q.total / maxTotal : 0
  }

  return result
}
