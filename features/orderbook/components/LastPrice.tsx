import { formatPrice } from '@/shared/utils/formatNumber'

interface Props {
  lastPrice: number | null
  prevLastPrice: number | null
}

/**
 * 显示最新成交价，根据涨跌切换颜色和背景色。
 * lastPrice 为 null 时显示占位符（加载中）。
 */
export default function LastPrice({ lastPrice, prevLastPrice }: Props) {
  if (lastPrice === null) {
    return (
      <div
        className="flex items-center justify-center h-10 bg-[rgba(134,152,170,0.12)]"
        aria-label="Last price loading"
      >
        <span className="text-lg font-bold text-[#8698aa]">--</span>
      </div>
    )
  }

  const isUp   = prevLastPrice !== null && lastPrice > prevLastPrice
  const isDown = prevLastPrice !== null && lastPrice < prevLastPrice

  const textColor = isUp ? 'text-[#00b15d]' : isDown ? 'text-[#FF5B5A]' : 'text-[#F0F4F8]'
  const bgColor   = isUp
    ? 'bg-[rgba(16,186,104,0.12)]'
    : isDown
    ? 'bg-[rgba(255,90,90,0.12)]'
    : 'bg-[rgba(134,152,170,0.12)]'
  const arrow     = isUp ? '↑' : isDown ? '↓' : ''
  const trend = isUp ? 'up' : isDown ? 'down' : 'unchanged'

  return (
    <div
      className={`flex items-center justify-center h-10 ${bgColor}`}
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Last price ${formatPrice(lastPrice)}, ${trend}`}
    >
      <span className={`text-lg font-bold ${textColor}`}>
        {formatPrice(lastPrice)}
        <span className='relative top-[-2px] ml-[2px]'>{arrow}</span>
      </span>
    </div>
  )
}
