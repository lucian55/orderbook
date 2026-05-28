import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFlashMap, FLASH_DURATION } from '@/shared/hooks/useFlashMap'

describe('useFlashMap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initial flashMap is empty', () => {
    const { result } = renderHook(() => useFlashMap())
    expect(result.current.flashMap.size).toBe(0)
  })

  it('flash with empty array is a no-op', () => {
    const { result } = renderHook(() => useFlashMap())
    act(() => {
      result.current.flash([])
    })
    expect(result.current.flashMap.size).toBe(0)
  })

  it('flashes all entries immediately with their colors (no stagger)', () => {
    const { result } = renderHook(() => useFlashMap())
    act(() => {
      result.current.flash([
        [100, 'green'],
        [200, 'red'],
      ])
    })
    expect(result.current.flashMap.get(100)).toBe('green')
    expect(result.current.flashMap.get(200)).toBe('red')
    expect(result.current.flashMap.size).toBe(2)
  })

  it('removes a flash after FLASH_DURATION', () => {
    const { result } = renderHook(() => useFlashMap())
    act(() => {
      result.current.flash([[100, 'green']])
    })
    expect(result.current.flashMap.has(100)).toBe(true)

    act(() => {
      vi.advanceTimersByTime(FLASH_DURATION)
    })
    expect(result.current.flashMap.has(100)).toBe(false)
  })

  it('re-flashing the same price resets its timer and updates color', () => {
    const { result } = renderHook(() => useFlashMap())
    act(() => {
      result.current.flash([[100, 'green']])
    })
    // 在过期前重新触发：颜色更新为 red，计时器重置
    act(() => {
      vi.advanceTimersByTime(FLASH_DURATION - 50)
      result.current.flash([[100, 'red']])
    })
    expect(result.current.flashMap.get(100)).toBe('red')

    // 旧计时器若未重置，会在这里把 100 删掉；重置后应仍存在
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(result.current.flashMap.get(100)).toBe('red')

    // 从重置时刻起再过完整时长后才移除
    act(() => {
      vi.advanceTimersByTime(FLASH_DURATION)
    })
    expect(result.current.flashMap.has(100)).toBe(false)
  })

  it('clears all timers on unmount', () => {
    const { result, unmount } = renderHook(() => useFlashMap())
    act(() => {
      result.current.flash([
        [100, 'green'],
        [200, 'red'],
      ])
    })

    unmount()

    expect(() => {
      vi.advanceTimersByTime(10_000)
    }).not.toThrow()
  })
})
