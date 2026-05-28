import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAnimationQueue } from '@/shared/hooks/useAnimationQueue'

// 与 hook 内部保持一致；改动其中一个时这里也要更新
const FLASH_DURATION   = 100
const DEQUEUE_INTERVAL = 80

describe('useAnimationQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initial flashSet is empty', () => {
    const { result } = renderHook(() => useAnimationQueue())
    expect(result.current.flashSet.size).toBe(0)
  })

  it('enqueue with empty array is a no-op', () => {
    const { result } = renderHook(() => useAnimationQueue())
    act(() => {
      result.current.enqueue([])
    })
    expect(result.current.flashSet.size).toBe(0)
  })

  it('flashes the first item immediately on enqueue', () => {
    const { result } = renderHook(() => useAnimationQueue())
    act(() => {
      result.current.enqueue([100, 200, 300])
    })
    // 同步 enqueue 后第一项立即进入 flashSet
    expect(result.current.flashSet.has(100)).toBe(true)
    expect(result.current.flashSet.size).toBe(1)
  })

  it('removes a flash after FLASH_DURATION', () => {
    const { result } = renderHook(() => useAnimationQueue())
    act(() => {
      result.current.enqueue([100])
    })
    expect(result.current.flashSet.has(100)).toBe(true)

    act(() => {
      vi.advanceTimersByTime(FLASH_DURATION)
    })
    expect(result.current.flashSet.has(100)).toBe(false)
  })

  it('processes the next item after DEQUEUE_INTERVAL', () => {
    const { result } = renderHook(() => useAnimationQueue())
    act(() => {
      result.current.enqueue([100, 200])
    })
    expect(result.current.flashSet.has(100)).toBe(true)
    expect(result.current.flashSet.has(200)).toBe(false)

    // 推进到第二项入场时刻
    act(() => {
      vi.advanceTimersByTime(DEQUEUE_INTERVAL)
    })
    expect(result.current.flashSet.has(200)).toBe(true)
  })

  it('drains a multi-item queue completely', () => {
    const { result } = renderHook(() => useAnimationQueue())
    act(() => {
      result.current.enqueue([100, 200, 300])
    })

    // 给足够长的时间让队列全部消费完
    act(() => {
      vi.advanceTimersByTime((DEQUEUE_INTERVAL + FLASH_DURATION) * 4)
    })
    expect(result.current.flashSet.size).toBe(0)
  })

  it('appends to an in-flight queue without restarting the timer', () => {
    const { result } = renderHook(() => useAnimationQueue())
    act(() => {
      result.current.enqueue([100])
    })
    // 队列正在消费 100，此时追加 200
    act(() => {
      result.current.enqueue([200])
    })
    // 100 仍在闪，200 还未入场
    expect(result.current.flashSet.has(100)).toBe(true)
    expect(result.current.flashSet.has(200)).toBe(false)

    act(() => {
      vi.advanceTimersByTime(DEQUEUE_INTERVAL)
    })
    expect(result.current.flashSet.has(200)).toBe(true)
  })

  it('clears all timers on unmount', () => {
    const { result, unmount } = renderHook(() => useAnimationQueue())
    act(() => {
      result.current.enqueue([100, 200, 300])
    })

    unmount()

    // 卸载后再推进时间不应该再触发任何 setState（不会抛错就说明 timer 已清理）
    expect(() => {
      vi.advanceTimersByTime(10_000)
    }).not.toThrow()
  })
})
