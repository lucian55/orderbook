'use client'

import { useState } from 'react'
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle'
import { formatPrice } from '@/shared/utils/formatNumber'
import { useOrderBook } from '../hooks/useOrderBook'
import { useLastPrice } from '../hooks/useLastPrice'
import { SIDE, WS_STATUS } from '../types'
import Header from './Header'
import SideList from './SideList'
import LastPrice from './LastPrice'
import LoadingSkeleton from './LoadingSkeleton'
import WsIndicator from './WsIndicator'
import TickSizeSelector from './TickSizeSelector'
import { ErrorBoundary } from './ErrorBoundary'
import { DEFAULT_TICK_SIZE, type TickSize } from '../constants'

export default function OrderBook() {
  return (
    <ErrorBoundary>
      <OrderBookInner />
    </ErrorBoundary>
  )
}

function OrderBookInner() {
  const [tickSize, setTickSize] = useState<TickSize>(DEFAULT_TICK_SIZE)
  const { bids, asks, prevBids, prevAsks, isLoading, wsStatus } = useOrderBook(tickSize)
  const { lastPrice, prevLastPrice } = useLastPrice()

  // 把最新价格同步到浏览器 tab 标题，方便切走后仍可监盘
  const arrow =
    lastPrice !== null && prevLastPrice !== null
      ? lastPrice > prevLastPrice ? '↑ ' : lastPrice < prevLastPrice ? '↓ ' : ''
      : ''
  const title = lastPrice !== null
    ? `${arrow}${formatPrice(lastPrice)} BTCPFC`
    : 'OrderBook'
  useDocumentTitle(title)

  // 有历史数据时不显示错误态（REST 兜底已接管），无数据时才显示
  const isError =
    (wsStatus === WS_STATUS.FAILED || wsStatus === WS_STATUS.TIMEOUT) &&
    bids.length === 0 &&
    asks.length === 0 &&
    !isLoading

  return (
    <div
      className="bg-[#131B29] text-[#F0F4F8] w-72 select-none"
      role="region"
      aria-label="Order Book"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="font-bold text-sm">Order Book</h2>
        <div className="flex items-center gap-2">
          <TickSizeSelector value={tickSize} onChange={setTickSize} />
          <WsIndicator status={wsStatus} />
        </div>
      </div>

      {isLoading ? (
        <>
          <Header />
          <LoadingSkeleton rows={8} />
          <LastPrice lastPrice={null} prevLastPrice={null} />
          <LoadingSkeleton rows={8} />
        </>
      ) : isError ? (
        <div className="flex items-center justify-center h-[224px] text-[#8698aa] text-sm">
          Failed to load data. Please refresh the page.
        </div>
      ) : (
        <>
          <Header />
          <SideList quotes={asks} prevQuotes={prevAsks} side={SIDE.SELL} tickSize={tickSize} />
          <LastPrice lastPrice={lastPrice} prevLastPrice={prevLastPrice} />
          <SideList quotes={bids} prevQuotes={prevBids} side={SIDE.BUY}  tickSize={tickSize} />
        </>
      )}
    </div>
  )
}
