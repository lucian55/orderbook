import Decimal from 'decimal.js'

/**
 * 将数字格式化为带千位分隔符的字符串，保留原始小数位。
 * 例：1234567.89 → "1,234,567.89"
 */
export function formatWithCommas(num: number | string, decimals?: number): string {
  const n = typeof num === 'string' ? parseFloat(num) : num
  if (isNaN(n)) return String(num)

  // 用 Decimal.toFixed 做舍入，规避 JS 原生 (1.005).toFixed(2)==="1.00" 的误差
  const str =
    decimals !== undefined
      ? new Decimal(n).toFixed(decimals)
      : typeof num === 'string'
        ? num
        : n.toString()
  const parts = str.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

/**
 * 将价格格式化为固定小数位 + 千位分隔符。
 * 保证列表中所有价格小数位一致，提升列对齐可读性。
 * 例：formatPrice(75000) → "75,000.0"，formatPrice(75000.5) → "75,000.5"
 */
export function formatPrice(price: number, decimals = 1): string {
  return formatWithCommas(new Decimal(price).toFixed(decimals))
}

/**
 * 根据 tick 精度推导价格的小数位数，让 UI 显示与聚合粒度对齐。
 * 例：tickSize=0.1 → 1，tickSize=1 → 0，tickSize=5 → 0
 */
export function tickDecimals(tickSize: number): number {
  if (tickSize >= 1) return 0
  return (tickSize.toString().split('.')[1] ?? '').length
}
