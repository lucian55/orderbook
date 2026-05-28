'use client'

import { memo, useEffect } from 'react'
import { useFlashMap, type FlashColor } from '@/shared/hooks/useFlashMap'
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

const flashClass = (color: FlashColor | undefined) =>
  color === 'green' ? 'animate-flash-green' : color === 'red' ? 'animate-flash-red' : ''

function SideList({ quotes, prevQuotes, side, tickSize = DEFAULT_TICK_SIZE }: Props) {
  const isBuy = side === SIDE.BUY
  const priceDecimals = tickDecimals(tickSize)

  // 买盘取前 8（最高价优先），卖盘取后 8（最低价在末尾，紧靠 LastPrice）
  const visible = isBuy ? quotes.slice(0, MAX_VISIBLE_QUOTES) : quotes.slice(-MAX_VISIBLE_QUOTES)
  // prevQuotes 与 quotes 在同一次 flush 中成对更新（同一渲染批次），直接对比即是"上一帧"。
  const prevVisible = isBuy
    ? prevQuotes.slice(0, MAX_VISIBLE_QUOTES)
    : prevQuotes.slice(-MAX_VISIBLE_QUOTES)

  // 仅对比可见区域的前一帧，避免将"从第 9 位升入 top 8"误判为新价格
  const prevSet = new Set(prevVisible.map(q => q.price))
  const prevMap = new Map(prevVisible.map(q => [q.price, q.size]))

  const barColor = isBuy ? 'bg-[rgba(16,186,104,0.12)]' : 'bg-[rgba(255,90,90,0.12)]'
  const priceColor = isBuy ? 'text-[#00b15d]' : 'text-[#FF5B5A]'
  // 新档位用本侧主色；数量变化按增减判定方向色
  const newRowColor: FlashColor = isBuy ? 'green' : 'red'

  // 两类闪烁目标不同：新档位闪整行，数量变化只闪 size 单元格，各用一套时间驱动的 map
  const { flashMap: rowFlashMap, flash: flashRows } = useFlashMap()
  const { flashMap: sizeFlashMap, flash: flashSizes } = useFlashMap()

  // quotes 变化时：检测新进入可见区的价格 + 已存在档位的数量变化，分别入场
  useEffect(() => {
    if (prevSet.size === 0) return // prevSet 为空说明是 snapshot，不触发动画
    const newRows: Array<[number, FlashColor]> = []
    const sizeChanges: Array<[number, FlashColor]> = []
    for (const q of visible) {
      if (!prevSet.has(q.price)) {
        newRows.push([q.price, newRowColor])
      } else {
        const prevSize = prevMap.get(q.price)
        if (prevSize !== undefined && prevSize !== q.size) {
          sizeChanges.push([q.price, q.size > prevSize ? 'green' : 'red'])
        }
      }
    }
    flashRows(newRows)
    flashSizes(sizeChanges)
  }, [quotes]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ul
      style={{ height: ITEM_HEIGHT * MAX_VISIBLE_QUOTES }}
      role="list"
      aria-label={isBuy ? 'Bids' : 'Asks'}
    >
      {visible.map(quote => {
        const rowFlash = flashClass(rowFlashMap.get(quote.price))
        const sizeFlash = flashClass(sizeFlashMap.get(quote.price))

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
              // size 变化时 key 改变 → 重挂载，强制 CSS 动画从头播放（同色连续变化也能重新触发）
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
