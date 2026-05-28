'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const FLASH_DURATION = 100 // 需与 globals.css 中动画时长一致
const DEQUEUE_INTERVAL = 80 // 相邻两条动画入场间隔，与 FLASH_DURATION 共同控制同时可见条数

/**
 * 管理行背景闪烁的异步队列。
 * 直接批量触发会导致所有行同时闪烁，用队列串行化后视觉上同时可见 1-4 条。
 *
 * 返回：
 *   flashSet — 当前正在闪烁的价格集合，驱动行 className
 *   enqueue  — 将一批新价格加入队列
 */
export function useAnimationQueue() {
  const queueRef = useRef<number[]>([])
  const [flashSet, setFlashSet] = useState<Set<number>>(new Set())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const processNextRef = useRef<() => void>(() => {})

  const processNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      timerRef.current = null
      return
    }
    const price = queueRef.current.shift()!

    setFlashSet(prev => new Set(prev).add(price))

    const removeId = setTimeout(() => {
      flashTimersRef.current.delete(removeId)
      setFlashSet(prev => {
        const next = new Set(prev)
        next.delete(price)
        return next
      })
    }, FLASH_DURATION)
    flashTimersRef.current.add(removeId)

    timerRef.current = setTimeout(() => processNextRef.current(), DEQUEUE_INTERVAL)
  }, [])

  useLayoutEffect(() => {
    processNextRef.current = processNext
  }, [processNext])

  const enqueue = useCallback(
    (prices: number[]) => {
      if (prices.length === 0) return
      queueRef.current.push(...prices)
      if (timerRef.current === null) processNext()
    },
    [processNext]
  )

  useEffect(() => {
    const timers = flashTimersRef.current
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timers.forEach(id => clearTimeout(id))
      timers.clear()
    }
  }, [])

  return { flashSet, enqueue }
}
