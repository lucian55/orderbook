'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type FlashColor = 'green' | 'red'

// 需 >= globals.css 中动画时长，确保动画完整播完后才移除 class（否则会被截断）
export const FLASH_DURATION = 300

/**
 * 时间驱动的闪烁管理：price → 颜色。
 *
 * 每个 price 维护独立的过期计时器，闪烁颜色在整段 FLASH_DURATION 内保持，
 * 不随父组件高频 re-render（RAF 每帧 flush）被中途清除——这正是之前
 * "用 prevMap 每帧现算 className" 会把动画截断到一帧的根因。
 *
 * 返回：
 *   flashMap — 当前正在闪烁的 price → 颜色，驱动行/单元格 className
 *   flash    — 触发一批闪烁，重复触发同一 price 会重置其计时器
 */
export function useFlashMap() {
  const [flashMap, setFlashMap] = useState<Map<number, FlashColor>>(new Map())
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const flash = useCallback((entries: Array<[number, FlashColor]>) => {
    if (entries.length === 0) return

    setFlashMap(prev => {
      const next = new Map(prev)
      for (const [price, color] of entries) next.set(price, color)
      return next
    })

    for (const [price] of entries) {
      const existing = timersRef.current.get(price)
      if (existing) clearTimeout(existing)
      const id = setTimeout(() => {
        timersRef.current.delete(price)
        setFlashMap(prev => {
          const next = new Map(prev)
          next.delete(price)
          return next
        })
      }, FLASH_DURATION)
      timersRef.current.set(price, id)
    }
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach(id => clearTimeout(id))
      timers.clear()
    }
  }, [])

  return { flashMap, flash }
}
