import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { OrderBookMessage, MSG_TYPE } from '@/features/orderbook/types'

// ─── 模块替换：注入可控的 fake client ─────────────────────────────────────────

type Handler = (msg: OrderBookMessage) => void

const fakeClient = {
  handlers: new Set<Handler>(),
  resubscribeCount: 0,
  softResubscribeCount: 0,
  subscribe(h: Handler) {
    this.handlers.add(h)
    return () => this.handlers.delete(h)
  },
  resubscribe() {
    this.resubscribeCount++
  },
  softResubscribe() {
    this.softResubscribeCount++
  },
  emit(msg: OrderBookMessage) {
    this.handlers.forEach(h => h(msg))
  },
  reset() {
    this.handlers.clear()
    this.resubscribeCount = 0
    this.softResubscribeCount = 0
  },
}

vi.mock('@/features/orderbook/websocket/BtseOrderBookClient', () => ({
  getBtseOrderBookClient: () => fakeClient,
}))

// REST 兜底永远不会成功，避免测试受网络影响
vi.mock('@/api/btse', () => ({
  fetchOrderBook: vi.fn().mockRejectedValue(new Error('not used in test')),
}))

import { useOrderBook } from '@/features/orderbook/hooks/useOrderBook'

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function snapshot(
  seqNum: number,
  bids: [string, string][],
  asks: [string, string][]
): OrderBookMessage {
  return {
    topic: 'update:BTCPFC',
    data: { type: MSG_TYPE.SNAPSHOT, seqNum, prevSeqNum: 0, symbol: 'BTCPFC', bids, asks },
  }
}

function delta(
  seqNum: number,
  prevSeqNum: number,
  bids: [string, string][],
  asks: [string, string][]
): OrderBookMessage {
  return {
    topic: 'update:BTCPFC',
    data: { type: MSG_TYPE.DELTA, seqNum, prevSeqNum, symbol: 'BTCPFC', bids, asks },
  }
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('useOrderBook', () => {
  beforeEach(() => {
    fakeClient.reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts in loading state with empty arrays', () => {
    const { result } = renderHook(() => useOrderBook(), { wrapper: makeWrapper() })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.bids).toEqual([])
    expect(result.current.asks).toEqual([])
  })

  it('snapshot populates bids/asks and exits loading', async () => {
    const { result } = renderHook(() => useOrderBook(), { wrapper: makeWrapper() })
    act(() => {
      fakeClient.emit(snapshot(1, [['100', '5']], [['200', '3']]))
    })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.bids).toHaveLength(1)
    expect(result.current.bids[0]).toMatchObject({ price: 100, size: 5 })
    expect(result.current.asks[0]).toMatchObject({ price: 200, size: 3 })
  })

  it('snapshot does not populate prev (avoids initial flash storm)', async () => {
    const { result } = renderHook(() => useOrderBook(), { wrapper: makeWrapper() })
    act(() => {
      fakeClient.emit(snapshot(1, [['100', '5']], [['200', '3']]))
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.prevBids).toEqual([])
    expect(result.current.prevAsks).toEqual([])
  })

  it('delta applies on top of snapshot and updates state after throttle', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useOrderBook(), { wrapper: makeWrapper() })

    act(() => {
      fakeClient.emit(snapshot(1, [['100', '5']], [['200', '3']]))
    })
    // delta：把 100 的 size 改成 10
    act(() => {
      fakeClient.emit(delta(2, 1, [['100', '10']], []))
    })

    // 150ms throttle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(result.current.bids[0]).toMatchObject({ price: 100, size: 10 })
  })

  it('seqNum mismatch triggers resubscribe (no state change)', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useOrderBook(), { wrapper: makeWrapper() })

    act(() => {
      fakeClient.emit(snapshot(1, [['100', '5']], [['200', '3']]))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    const bidsBefore = result.current.bids
    // prevSeqNum=99 与 lastSeqNum=1 不匹配
    act(() => {
      fakeClient.emit(delta(100, 99, [['100', '999']], []))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(fakeClient.softResubscribeCount).toBe(1)
    // 错位的 delta 不应被应用
    expect(result.current.bids).toBe(bidsBefore)
  })

  it('awaitingSnapshot barrier collapses repeated gaps into one resubscribe', async () => {
    vi.useFakeTimers()
    renderHook(() => useOrderBook(), { wrapper: makeWrapper() })

    act(() => {
      fakeClient.emit(snapshot(1, [['100', '5']], [['200', '3']]))
    })

    // 连续触发 3 次错位
    act(() => {
      fakeClient.emit(delta(100, 99, [], []))
      fakeClient.emit(delta(101, 99, [], []))
      fakeClient.emit(delta(102, 99, [], []))
    })

    // 首次断层置 awaitingSnapshot 屏障，后续 delta 在 seqNum 校验前即被丢弃，
    // 因此整段断层只触发一次 softResubscribe
    expect(fakeClient.softResubscribeCount).toBe(1)
  })

  it('flush coalescing: multiple deltas within one frame cause one render', async () => {
    vi.useFakeTimers()
    let renderCount = 0
    const { result } = renderHook(
      () => {
        renderCount++
        return useOrderBook()
      },
      { wrapper: makeWrapper() }
    )

    act(() => {
      fakeClient.emit(snapshot(1, [['100', '5']], [['200', '3']]))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    const renderCountAfterSnapshot = renderCount

    // 同一帧内连发 3 条 delta
    act(() => {
      fakeClient.emit(delta(2, 1, [['100', '6']], []))
      fakeClient.emit(delta(3, 2, [['100', '7']], []))
      fakeClient.emit(delta(4, 3, [['100', '8']], []))
    })
    // RAF 未触发前不应有额外 render
    expect(renderCount).toBe(renderCountAfterSnapshot)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    // 只产生一次 flush
    expect(renderCount).toBeLessThanOrEqual(renderCountAfterSnapshot + 1)
    // 最终值为最后一次 delta 的结果
    expect(result.current.bids[0].size).toBe(8)
  })

  it('tickSize change re-aggregates without populating prev', async () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ tick }: { tick: 0.1 | 1 }) => useOrderBook(tick), {
      wrapper: makeWrapper(),
      initialProps: { tick: 0.1 as 0.1 | 1 },
    })

    act(() => {
      fakeClient.emit(
        snapshot(
          1,
          [
            ['100.3', '1'],
            ['100.5', '2'],
            ['101.0', '3'],
          ],
          [['200', '1']]
        )
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(result.current.bids).toHaveLength(3)

    // 切换 tick → 重新聚合
    rerender({ tick: 1 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    // 100.3 / 100.5 合并到 100；101 独立
    expect(result.current.bids).toHaveLength(2)
    expect(result.current.bids[0]).toMatchObject({ price: 101, size: 3 })
    expect(result.current.bids[1]).toMatchObject({ price: 100, size: 3 })
    // 聚合切换不应填充 prev（不触发动画）
    expect(result.current.prevBids).toEqual([])
  })
})
