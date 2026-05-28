'use client'

import { memo, useDeferredValue, useEffect } from 'react'
import { useAnimationQueue } from '@/shared/hooks/useAnimationQueue'
import { formatWithCommas, formatPrice, tickDecimals } from '@/shared/utils/formatNumber'
import { Quote, Side, SIDE } from '../types'
import { MAX_VISIBLE_QUOTES, DEFAULT_TICK_SIZE, type TickSize } from '../constants'

const ITEM_HEIGHT = 28

interface Props {
  quotes: Quote[]
  prevQuotes: Quote[]
  side: Side
  tickSize?: TickSize
}

function SideList({ quotes, prevQuotes, side, tickSize = DEFAULT_TICK_SIZE }: Props) {
  const isBuy = side === SIDE.BUY
  const priceDecimals = tickDecimals(tickSize)

  // prevQuotes 仅用于动画对比，是非紧急的派生计算。
  // 用 useDeferredValue 把它降为低优先级渲染，让主路径（价格显示）先呈现，
  // 在更新风暴期间动画判断会自动跳过中间帧，减少卡顿。
  const deferredPrev = useDeferredValue(prevQuotes)

  // 买盘取前 8（最高价优先），卖盘取后 8（最低价在末尾，紧靠 LastPrice）
  const visible = isBuy ? quotes.slice(0, MAX_VISIBLE_QUOTES) : quotes.slice(-MAX_VISIBLE_QUOTES)
  const prevVisible = isBuy
    ? deferredPrev.slice(0, MAX_VISIBLE_QUOTES)
    : deferredPrev.slice(-MAX_VISIBLE_QUOTES)

  // 仅对比可见区域的前一帧，避免将"从第 9 位升入 top 8"误判为新价格
  const prevSet = new Set(prevVisible.map(q => q.price))
  const prevMap = new Map(prevVisible.map(q => [q.price, q.size]))

  const barColor = isBuy ? 'bg-[rgba(16,186,104,0.12)]' : 'bg-[rgba(255,90,90,0.12)]'
  const priceColor = isBuy ? 'text-[#00b15d]' : 'text-[#FF5B5A]'
  const flashClass = isBuy ? 'animate-flash-green' : 'animate-flash-red'

  const { flashSet, enqueue } = useAnimationQueue()

  // quotes 变化时检测新进入可见区的价格并入队
  useEffect(() => {
    if (prevSet.size === 0) return // prevSet 为空说明是 snapshot，不触发动画
    const newPrices = visible.filter(q => !prevSet.has(q.price)).map(q => q.price)
    enqueue(newPrices)
  }, [quotes]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ul
      style={{ height: ITEM_HEIGHT * MAX_VISIBLE_QUOTES }}
      role="list"
      aria-label={isBuy ? 'Bids' : 'Asks'}
    >
      {visible.map(quote => {
        const rowFlash = flashSet.has(quote.price) ? flashClass : ''

        const prevSize = prevMap.get(quote.price)
        const sizeChanged = prevSize !== undefined && prevSize !== quote.size
        const sizeFlash = sizeChanged
          ? quote.size > prevSize
            ? 'animate-flash-green'
            : 'animate-flash-red'
          : ''

        return (
          <li
            key={quote.price}
            style={{ height: ITEM_HEIGHT }}
            aria-label={`Price ${formatPrice(quote.price, priceDecimals)}, Size ${formatWithCommas(quote.size)}, Total ${formatWithCommas(quote.total)}`}
            className={`relative flex items-center cursor-default hover:bg-[#1E3059] ${rowFlash}`}
          >
            <div
              className={`absolute right-0 top-0 bottom-0 ${barColor}`}
              style={{ width: `${quote.totalPercent * 100}%` }}
            />
            <span className={`flex-1 px-2 text-sm relative z-10 ${priceColor}`}>
              {formatPrice(quote.price, priceDecimals)}
            </span>
            <span
              key={`${quote.price}_${quote.size}`}
              className={`w-24 text-right pr-2 text-sm relative z-10 text-[#F0F4F8] ${sizeFlash}`}
            >
              {formatWithCommas(quote.size, 5)}
            </span>
            <span className="w-24 text-right pr-2 text-sm relative z-10 text-[#F0F4F8]">
              {formatWithCommas(quote.total, 5)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// memo 防止 LastPrice 更新导致父组件 re-render 时截断正在播放的行动画
export default memo(SideList)
