import { describe, it, expect } from 'vitest'
import {
  applyDelta,
  aggregateByTick,
  computeQuotes,
  usdToBtcBook,
  visibleQuotesEqual,
} from '@/features/orderbook/utils/orderBookUtils'
import { SIDE } from '@/features/orderbook/types'

// ─── applyDelta ──────────────────────────────────────────────────────────────

describe('applyDelta', () => {
  it('adds new entries', () => {
    const book = new Map([[100, 10]])
    const result = applyDelta(book, [['200', '20']])
    expect(result.get(200)).toBe(20)
    expect(result.get(100)).toBe(10)
  })

  it('updates existing entries', () => {
    const book = new Map([[100, 10]])
    const result = applyDelta(book, [['100', '15']])
    expect(result.get(100)).toBe(15)
  })

  it('deletes entries when size is 0', () => {
    const book = new Map([
      [100, 10],
      [200, 20],
    ])
    const result = applyDelta(book, [['100', '0']])
    expect(result.has(100)).toBe(false)
    expect(result.get(200)).toBe(20)
  })

  it('does not mutate the original map', () => {
    const book = new Map([[100, 10]])
    applyDelta(book, [['200', '20']])
    expect(book.has(200)).toBe(false)
  })

  it('returns a new map instance', () => {
    const book = new Map([[100, 10]])
    const result = applyDelta(book, [['100', '10']])
    expect(result).not.toBe(book)
  })

  it('handles empty delta', () => {
    const book = new Map([[100, 10]])
    const result = applyDelta(book, [])
    expect(result.get(100)).toBe(10)
    expect(result.size).toBe(1)
  })

  it('processes multiple changes in one delta', () => {
    const book = new Map([
      [100, 10],
      [200, 20],
    ])
    const result = applyDelta(book, [
      ['100', '0'],
      ['200', '30'],
      ['300', '5'],
    ])
    expect(result.has(100)).toBe(false)
    expect(result.get(200)).toBe(30)
    expect(result.get(300)).toBe(5)
  })
})

// ─── usdToBtcBook ────────────────────────────────────────────────────────────

describe('usdToBtcBook', () => {
  it('converts USD notional size to BTC amount (size / price)', () => {
    const book = new Map([
      [100, 10], // 10 USD / 100 = 0.1 BTC
      [200, 50], // 50 USD / 200 = 0.25 BTC
    ])
    const result = usdToBtcBook(book)
    expect(result.get(100)).toBeCloseTo(0.1)
    expect(result.get(200)).toBeCloseTo(0.25)
  })

  it('drops entries with non-positive price or size', () => {
    const book = new Map([
      [0, 10],
      [100, 0],
      [-5, 3],
      [200, 4],
    ])
    const result = usdToBtcBook(book)
    expect(result.size).toBe(1)
    expect(result.get(200)).toBeCloseTo(0.02)
  })

  it('does not mutate the original map', () => {
    const book = new Map([[100, 10]])
    usdToBtcBook(book)
    expect(book.get(100)).toBe(10)
  })
})

// ─── computeQuotes ───────────────────────────────────────────────────────────

describe('computeQuotes', () => {
  it('returns empty array for empty book', () => {
    expect(computeQuotes(new Map(), SIDE.BUY)).toEqual([])
    expect(computeQuotes(new Map(), SIDE.SELL)).toEqual([])
  })

  it('sorts prices in descending order regardless of insertion order', () => {
    const book = new Map([
      [100, 5],
      [300, 3],
      [200, 8],
    ])
    const result = computeQuotes(book, SIDE.BUY)
    expect(result.map(q => q.price)).toEqual([300, 200, 100])
  })

  it('filters out entries with size <= 0', () => {
    const book = new Map([
      [100, 5],
      [200, 0],
      [300, -1],
    ])
    const result = computeQuotes(book, SIDE.BUY)
    expect(result).toHaveLength(1)
    expect(result[0].price).toBe(100)
  })

  describe('buy side', () => {
    // 买盘：从最高价向下累计，最低价的 total 最大（maxTotal）
    const book = new Map([
      [100, 5],
      [200, 3],
      [300, 2],
    ])

    it('cumulates total from highest price downward', () => {
      const result = computeQuotes(book, SIDE.BUY)
      expect(result[0]).toMatchObject({ price: 300, total: 2 }) // 仅自身
      expect(result[1]).toMatchObject({ price: 200, total: 5 }) // 2+3
      expect(result[2]).toMatchObject({ price: 100, total: 10 }) // 2+3+5
    })

    it('last element has totalPercent = 1', () => {
      const result = computeQuotes(book, SIDE.BUY)
      expect(result[result.length - 1].totalPercent).toBe(1)
    })

    it('calculates intermediate totalPercent correctly', () => {
      const result = computeQuotes(book, SIDE.BUY)
      expect(result[0].totalPercent).toBeCloseTo(0.2) // 2/10
      expect(result[1].totalPercent).toBeCloseTo(0.5) // 5/10
    })
  })

  describe('sell side', () => {
    // 卖盘：从最低价向上累计，最高价的 total 最大（maxTotal）
    const book = new Map([
      [100, 5],
      [200, 3],
      [300, 2],
    ])

    it('cumulates total from lowest price upward', () => {
      const result = computeQuotes(book, SIDE.SELL)
      // 数组降序：index 0=300, 1=200, 2=100
      expect(result[0]).toMatchObject({ price: 300, total: 10 }) // 5+3+2
      expect(result[1]).toMatchObject({ price: 200, total: 8 }) // 5+3
      expect(result[2]).toMatchObject({ price: 100, total: 5 }) // 仅自身
    })

    it('first element has totalPercent = 1', () => {
      const result = computeQuotes(book, SIDE.SELL)
      expect(result[0].totalPercent).toBe(1)
    })

    it('calculates intermediate totalPercent correctly', () => {
      const result = computeQuotes(book, SIDE.SELL)
      expect(result[1].totalPercent).toBeCloseTo(0.8) // 8/10
      expect(result[2].totalPercent).toBeCloseTo(0.5) // 5/10
    })
  })
})

// ─── aggregateByTick ─────────────────────────────────────────────────────────

describe('aggregateByTick', () => {
  it('returns the original map when tickSize <= 0', () => {
    const book = new Map([[100.3, 1]])
    expect(aggregateByTick(book, 0, SIDE.BUY)).toBe(book)
    expect(aggregateByTick(book, -1, SIDE.BUY)).toBe(book)
  })

  it('buy: floors prices into buckets and sums size', () => {
    // 75000.3 / 75000.5 / 75000.8 → 75000；75001.0 → 75001
    const book = new Map([
      [75000.3, 1],
      [75000.5, 2],
      [75000.8, 3],
      [75001.0, 4],
    ])
    const result = aggregateByTick(book, 1, SIDE.BUY)
    expect(result.get(75000)).toBe(6)
    expect(result.get(75001)).toBe(4)
    expect(result.size).toBe(2)
  })

  it('sell: ceils prices into buckets and sums size', () => {
    // 75000.3 / 75000.8 → 75001；75001.0 → 75001（恰好相等仍向上等价）
    const book = new Map([
      [75000.3, 1],
      [75000.8, 2],
      [75001.0, 4],
    ])
    const result = aggregateByTick(book, 1, SIDE.SELL)
    expect(result.get(75001)).toBe(7)
    expect(result.size).toBe(1)
  })

  it('handles fractional tick sizes (0.5)', () => {
    // tick=0.5: buy 向下到最近 0.5 倍数
    const book = new Map([
      [100.1, 1], // → 100.0
      [100.3, 2], // → 100.0
      [100.6, 3], // → 100.5
      [100.9, 4], // → 100.5
    ])
    const result = aggregateByTick(book, 0.5, SIDE.BUY)
    expect(result.get(100.0)).toBe(3)
    expect(result.get(100.5)).toBe(7)
  })

  it('does not mutate the original map', () => {
    const book = new Map([[100.3, 1]])
    aggregateByTick(book, 1, SIDE.BUY)
    expect(book.get(100.3)).toBe(1)
    expect(book.size).toBe(1)
  })

  it('keeps on-tick prices in their own bucket despite float division noise', () => {
    // 73540.7 / 0.1 = 735406.9999999999，未校正时 floor 会错配到 73540.6
    const buy = aggregateByTick(new Map([[73540.7, 1]]), 0.1, SIDE.BUY)
    expect(buy.get(73540.7)).toBe(1)
    expect(buy.has(73540.6)).toBe(false)

    // 卖盘对称：整 tick 价格不应被 ceil 顶到上一档
    const sell = aggregateByTick(new Map([[73540.7, 1]]), 0.1, SIDE.SELL)
    expect(sell.get(73540.7)).toBe(1)
    expect(sell.has(73540.8)).toBe(false)
  })
})

describe('computeQuotes with tickSize', () => {
  it('buy: aggregates by tick then cumulates total', () => {
    const book = new Map([
      [100.3, 1],
      [100.5, 2],
      [101.0, 3],
    ])
    // buy + tick=1：100.3/100.5 → 100，101 → 101
    // 降序：[101 (size=3), 100 (size=3)]，total 从高到低累加
    const result = computeQuotes(book, SIDE.BUY, 1)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ price: 101, size: 3, total: 3 })
    expect(result[1]).toMatchObject({ price: 100, size: 3, total: 6 })
  })

  it('sell: aggregates by tick (ceil) then cumulates total', () => {
    const book = new Map([
      [100.3, 1],
      [100.5, 2],
      [101.0, 3],
    ])
    // sell + tick=1：100.3/100.5 → 101，101 → 101，全部合并到 101
    const result = computeQuotes(book, SIDE.SELL, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ price: 101, size: 6, total: 6 })
  })

  it('tickSize=0 returns ungrouped result (backwards compatible)', () => {
    const book = new Map([
      [100, 1],
      [200, 2],
    ])
    const result = computeQuotes(book, SIDE.BUY)
    expect(result.map(q => q.price)).toEqual([200, 100])
  })
})

// ─── visibleQuotesEqual ──────────────────────────────────────────────────────

describe('visibleQuotesEqual', () => {
  const q = (price: number, size: number, totalPercent = 0) => ({
    price,
    size,
    total: 0,
    totalPercent,
  })

  it('returns true for identical arrays', () => {
    const arr = [q(100, 10), q(90, 5)]
    expect(visibleQuotesEqual(arr, arr, SIDE.BUY)).toBe(true)
  })

  it('returns true for deep-equal arrays', () => {
    const a = [q(100, 10, 0.5)]
    const b = [q(100, 10, 0.5)]
    expect(visibleQuotesEqual(a, b, SIDE.BUY)).toBe(true)
  })

  it('returns false when price differs', () => {
    expect(visibleQuotesEqual([q(100, 10)], [q(101, 10)], SIDE.BUY)).toBe(false)
  })

  it('returns false when size differs', () => {
    expect(visibleQuotesEqual([q(100, 10)], [q(100, 20)], SIDE.BUY)).toBe(false)
  })

  it('returns false when totalPercent differs', () => {
    expect(visibleQuotesEqual([q(100, 10, 0.5)], [q(100, 10, 0.6)], SIDE.BUY)).toBe(false)
  })

  it('returns false when lengths differ', () => {
    expect(visibleQuotesEqual([q(100, 10)], [q(100, 10), q(90, 5)], SIDE.BUY)).toBe(false)
  })

  it('buy: ignores entries beyond MAX_VISIBLE_QUOTES', () => {
    // 10 条数据，前 8 条相同，第 9、10 条不同
    const base = Array.from({ length: 10 }, (_, i) => q(100 - i, 10))
    const other = [...base.slice(0, 8), q(91, 999), q(90, 999)]
    expect(visibleQuotesEqual(base, other, SIDE.BUY)).toBe(true)
  })

  it('sell: ignores entries beyond MAX_VISIBLE_QUOTES (compares last 8)', () => {
    // 10 条数据，后 8 条相同，前 2 条不同
    const base = Array.from({ length: 10 }, (_, i) => q(100 - i, 10))
    const other = [q(100, 999), q(99, 999), ...base.slice(2)]
    expect(visibleQuotesEqual(base, other, SIDE.SELL)).toBe(true)
  })

  it('sell: detects change in the visible last 8 entries', () => {
    const base = Array.from({ length: 10 }, (_, i) => q(100 - i, 10))
    const other = [...base.slice(0, 9), q(90, 999)] // 最后一条 size 不同
    expect(visibleQuotesEqual(base, other, SIDE.SELL)).toBe(false)
  })
})
