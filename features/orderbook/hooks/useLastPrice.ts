'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchLastPrice } from '@/api/btse'
import { getBtseLastPriceClient } from '../websocket/BtseLastPriceClient'
import { TradeHistoryMessage } from '../types'

const MSG_TIMEOUT_MS = 30_000 // 超过 30s 未收到消息启用 REST 兜底
const CHECK_INTERVAL_MS = 10_000 // 每 10s 检查一次
const FALLBACK_INTERVAL_MS = 3_000 // REST 轮询间隔
const RESUBSCRIBE_COOLDOWN = 5_000 // 两次主动重订阅之间的最小间隔
const STALE_MSG_MS = 10_000 // 切回前台/网络恢复时，超过此时长无消息才主动重连

// React Query 缓存 key，集中定义避免拼写错误
const FALLBACK_QUERY_KEY = ['lastPriceFallback']

export function useLastPrice() {
  const queryClient = useQueryClient()
  const client = getBtseLastPriceClient()

  const [lastPrice, setLastPrice] = useState<number | null>(null)
  const [prevLastPrice, setPrevLastPrice] = useState<number | null>(null)
  const [restEnabled, setRestEnabled] = useState(false)

  const lastMsgTimeRef = useRef<number>(Date.now())
  const lastResubscribeTimeRef = useRef<number>(0) // 上次主动重订阅的时间，冷却控制
  const pendingPriceRef = useRef<number | null>(null) // RAF 期间暂存最新价格，丢弃中间帧
  const rafIdRef = useRef<number | null>(null)
  const lastPriceRef = useRef<number | null>(null) // lastPrice 的同步镜像，供 flush 读取当前值

  /** 带冷却的重订阅，避免短时间内多入口（visibility/online/timeout）重复触发 */
  const safeResubscribe = useCallback(() => {
    const now = Date.now()
    if (now - lastResubscribeTimeRef.current < RESUBSCRIBE_COOLDOWN) return
    lastResubscribeTimeRef.current = now
    client.resubscribe()
  }, [client])

  /**
   * 将 pendingPriceRef 中的最新价格提交到 state。
   * 相同价格不触发更新，避免无意义的 render。
   */
  const flush = () => {
    if (pendingPriceRef.current === null) return
    const next = pendingPriceRef.current
    pendingPriceRef.current = null
    if (next === lastPriceRef.current) return
    setPrevLastPrice(lastPriceRef.current)
    lastPriceRef.current = next
    setLastPrice(next)
    setRestEnabled(false)
  }

  useEffect(() => {
    const handleMessage = (msg: TradeHistoryMessage) => {
      lastMsgTimeRef.current = Date.now()
      const raw = msg.data[0]?.price
      if (raw == null) return
      const price = Number(raw)
      if (!Number.isFinite(price)) return

      // 用 RAF 批量合并同一帧内的多条消息，只取最新一条
      pendingPriceRef.current = price
      if (rafIdRef.current !== null) return
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        flush()
      })
    }

    const unsub = client.subscribe(handleMessage)
    return () => {
      unsub()
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  // 30s 无消息则启用 REST 轮询并尝试重连
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - lastMsgTimeRef.current > MSG_TIMEOUT_MS) {
        setRestEnabled(true)
        safeResubscribe()
      }
    }, CHECK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [safeResubscribe])

  // 切回前台时：仅当消息已超过 STALE_MSG_MS 不新鲜才重连，健康连接保持不动
  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastMsgTimeRef.current > STALE_MSG_MS
      ) {
        safeResubscribe()
        queryClient.invalidateQueries({ queryKey: FALLBACK_QUERY_KEY })
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [safeResubscribe, queryClient])

  // 网络恢复时：同样以消息新鲜度为准，避免拆掉仍在正常工作的连接
  useEffect(() => {
    const handleOnline = () => {
      if (Date.now() - lastMsgTimeRef.current > STALE_MSG_MS) {
        safeResubscribe()
        queryClient.invalidateQueries({ queryKey: FALLBACK_QUERY_KEY })
      }
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [safeResubscribe, queryClient])

  // REST 兜底：仅在 WS 超时时启用
  const fallbackQuery = useQuery({
    queryKey: FALLBACK_QUERY_KEY,
    queryFn: fetchLastPrice,
    refetchInterval: restEnabled ? FALLBACK_INTERVAL_MS : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0,
  })

  useEffect(() => {
    if (!fallbackQuery.data || !restEnabled) return
    const price = fallbackQuery.data
    setPrevLastPrice(lastPriceRef.current)
    lastPriceRef.current = price
    setLastPrice(price)
  }, [fallbackQuery.data, restEnabled])

  return { lastPrice, prevLastPrice }
}
