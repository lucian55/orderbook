'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchOrderBook } from '@/api/btse'
import { getBtseOrderBookClient } from '../websocket/BtseOrderBookClient'
import { applyDelta, computeQuotes, visibleQuotesEqual } from '../utils/orderBookUtils'
import { OrderBookMessage, Quote, WsHealthStatus, WS_STATUS, MSG_TYPE } from '../types'
import { DEFAULT_TICK_SIZE, type TickSize } from '../constants'

const RESUBSCRIBE_COOLDOWN = 5_000   // 两次主动重订阅之间的最小间隔，防止频繁重连
const MSG_TIMEOUT_MS       = 30_000  // 超过 30s 没有收到消息认为 WS 已超时
const CHECK_INTERVAL_MS    = 10_000  // 每 10s 检查一次消息时间戳
const FALLBACK_INTERVAL_MS = 3_000   // WS 超时后 REST 轮询间隔
const FLUSH_THROTTLE_MS    = 150     // 合并高频 delta 更新，150ms 内只触发一次 render；
                                     // 略大于 FLASH_DURATION（100ms），确保动画有足够时间完成

// React Query 缓存 key，集中定义避免拼写错误
const FALLBACK_QUERY_KEY = ['orderBookFallback']

export interface UseOrderBookResult {
  bids: Quote[]
  asks: Quote[]
  prevBids: Quote[]
  prevAsks: Quote[]
  isLoading: boolean
  wsStatus: WsHealthStatus
}

export function useOrderBook(tickSize: TickSize = DEFAULT_TICK_SIZE): UseOrderBookResult {
  const queryClient = useQueryClient()
  const client = getBtseOrderBookClient()

  // tickSize 写入 ref，避免 flushToState 因依赖变化而重新创建
  const tickSizeRef = useRef<TickSize>(tickSize)
  tickSizeRef.current = tickSize

  const [bids, setBids] = useState<Quote[]>([])
  const [asks, setAsks] = useState<Quote[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [wsStatus, setWsStatus] = useState<WsHealthStatus>(WS_STATUS.CONNECTING)

  // 原始盘口数据，以 price → size 的 Map 存储，避免每次 delta 都重建数组
  const bidsMapRef = useRef<Map<number, number>>(new Map())
  const asksMapRef = useRef<Map<number, number>>(new Map())

  const lastSeqNumRef           = useRef<number>(-1)                       // 上一条消息的 seqNum，用于校验连续性
  const lastMsgTimeRef          = useRef<number>(Date.now())                // 最后一次收到消息的时间，用于超时检测
  const lastResubscribeTimeRef  = useRef<number>(0)                        // 上次主动重订阅的时间，用于冷却控制
  const timerRef                = useRef<number | null>(null)               // flush 节流定时器
  const wsStatusRef             = useRef<WsHealthStatus>(WS_STATUS.CONNECTING) // wsStatus 的 ref 镜像，供非 render 上下文读取

  // bids/asks 的 ref 镜像，用于在 flushToState 中同步读取"上一帧"数据
  // 不能直接用 state，因为 setState 是异步的，读取时可能拿到旧值
  const bidsStateRef = useRef<Quote[]>([])
  const asksStateRef = useRef<Quote[]>([])
  const prevBidsRef  = useRef<Quote[]>([])
  const prevAsksRef  = useRef<Quote[]>([])

  /**
   * 将当前 Map 计算为 Quote 数组并推送到 React state。
   * @param fromSnapshot 为 true 时清空 prev，不触发动画（snapshot 是全量数据，不应视为"新价格"）
   */
  const flushToState = useCallback((fromSnapshot = false) => {
    const tick = tickSizeRef.current
    const newBids = computeQuotes(bidsMapRef.current, 'buy',  tick)
    const newAsks = computeQuotes(asksMapRef.current, 'sell', tick)

    const bidsChanged = !visibleQuotesEqual(bidsStateRef.current, newBids, 'buy')
    const asksChanged = !visibleQuotesEqual(asksStateRef.current, newAsks, 'sell')

    // 可见区没有任何变化时跳过 setState，避免无意义的 re-render
    // fromSnapshot 时强制更新，确保重连后数据和动画状态都能被重置
    if (!fromSnapshot && !bidsChanged && !asksChanged) return

    if (fromSnapshot) {
      // snapshot 时清空 prev，避免所有行都被标记为"新价格"触发动画
      prevBidsRef.current = []
      prevAsksRef.current = []
    } else {
      // delta 时先保存当前值为 prev，再更新；顺序不能颠倒
      prevBidsRef.current = bidsStateRef.current
      prevAsksRef.current = asksStateRef.current
    }

    bidsStateRef.current = newBids
    asksStateRef.current = newAsks

    setBids(newBids)
    setAsks(newAsks)
  }, [])

  /**
   * 节流版 flushToState：500ms 内多次 delta 只触发一次 render，
   * 保证动画有足够时间完成。
   */
  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      flushToState()
    }, FLUSH_THROTTLE_MS) as unknown as number
  }, [flushToState])

  /**
   * 带冷却的重订阅：强制关闭当前连接并重新获取 snapshot，
   * 用于 seqNum 断层或长时间无消息的恢复场景。
   */
  const safeResubscribe = useCallback(() => {
    const now = Date.now()
    if (now - lastResubscribeTimeRef.current < RESUBSCRIBE_COOLDOWN) return
    lastResubscribeTimeRef.current = now
    client.resubscribe()
  }, [client])

  // 处理 WS 消息：snapshot 重置盘口，delta 增量更新
  useEffect(() => {
    const handleMessage = (msg: OrderBookMessage) => {
      lastMsgTimeRef.current = Date.now()
      const { type, seqNum, prevSeqNum, bids: bidsDelta, asks: asksDelta } = msg.data

      if (type === MSG_TYPE.SNAPSHOT) {
        // 全量快照：重建 Map，忽略 size=0 的档位
        const newBidsMap = new Map<number, number>()
        const newAsksMap = new Map<number, number>()
        for (const [p, s] of bidsDelta) {
          const size = parseFloat(s)
          if (size > 0) newBidsMap.set(parseFloat(p), size)
        }
        for (const [p, s] of asksDelta) {
          const size = parseFloat(s)
          if (size > 0) newAsksMap.set(parseFloat(p), size)
        }
        bidsMapRef.current = newBidsMap
        asksMapRef.current = newAsksMap
        lastSeqNumRef.current = seqNum
        if (wsStatusRef.current !== WS_STATUS.HEALTHY) {
          wsStatusRef.current = WS_STATUS.HEALTHY
          setWsStatus(WS_STATUS.HEALTHY)
        }
        setIsLoading(false)
        flushToState(true)  // snapshot 不触发动画
        return
      }

      // delta：校验 seqNum 连续性，断层则重新订阅获取新 snapshot
      if (prevSeqNum !== lastSeqNumRef.current) {
        safeResubscribe()
        return
      }
      lastSeqNumRef.current = seqNum
      bidsMapRef.current = applyDelta(bidsMapRef.current, bidsDelta)
      asksMapRef.current = applyDelta(asksMapRef.current, asksDelta)
      scheduleFlush()
    }

    const unsub = client.subscribe(handleMessage)
    return () => {
      unsub()
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [client, flushToState, safeResubscribe, scheduleFlush])

  // tickSize 切换：用 fromSnapshot=true 重新计算，避免聚合后所有行都被当作"新价格"闪烁。
  // 必须在 paint 前同步执行，否则会出现一帧"旧 quotes 用新 priceDecimals 渲染"导致价格重复显示。
  useLayoutEffect(() => {
    // Map 为空（首次挂载/未拿到数据）时跳过，避免无意义的 setState
    if (bidsMapRef.current.size === 0 && asksMapRef.current.size === 0) return
    flushToState(true)
  }, [tickSize, flushToState])

  // 超时检测：30s 未收到消息则标记为超时并触发重订阅
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - lastMsgTimeRef.current > MSG_TIMEOUT_MS) {
        wsStatusRef.current = WS_STATUS.TIMEOUT
        setWsStatus(WS_STATUS.TIMEOUT)
        safeResubscribe()
      }
    }, CHECK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [safeResubscribe])

  // 页面从后台切回前台时重新订阅，确保数据新鲜
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        safeResubscribe()
        queryClient.invalidateQueries({ queryKey: FALLBACK_QUERY_KEY })
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [safeResubscribe, queryClient])

  // 网络恢复时重新订阅
  useEffect(() => {
    const handleOnline = () => {
      safeResubscribe()
      queryClient.invalidateQueries({ queryKey: FALLBACK_QUERY_KEY })
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [safeResubscribe, queryClient])

  // WS 超时或失败时启用 REST 兜底轮询
  const fallbackQuery = useQuery({
    queryKey: FALLBACK_QUERY_KEY,
    queryFn: fetchOrderBook,
    refetchInterval: () =>
      wsStatus === WS_STATUS.TIMEOUT || wsStatus === WS_STATUS.FAILED
        ? FALLBACK_INTERVAL_MS
        : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    staleTime: 0,
    gcTime: 0,
  })

  // 将 REST 兜底数据写入 Map 并刷新 state
  useEffect(() => {
    if (!fallbackQuery.data) return
    if (wsStatus !== WS_STATUS.TIMEOUT && wsStatus !== WS_STATUS.FAILED) return
    const { buyQuote, sellQuote } = fallbackQuery.data
    const newBidsMap = new Map<number, number>()
    const newAsksMap = new Map<number, number>()
    for (const { price, size } of buyQuote) {
      const s = parseFloat(size)
      if (s > 0) newBidsMap.set(parseFloat(price), s)
    }
    for (const { price, size } of sellQuote) {
      const s = parseFloat(size)
      if (s > 0) newAsksMap.set(parseFloat(price), s)
    }
    bidsMapRef.current = newBidsMap
    asksMapRef.current = newAsksMap
    setIsLoading(false)
    flushToState(true)  // REST 全量数据，同样不触发动画
  }, [fallbackQuery.data, wsStatus, flushToState])

  return {
    bids,
    asks,
    prevBids: prevBidsRef.current,
    prevAsks: prevAsksRef.current,
    isLoading,
    wsStatus,
  }
}
