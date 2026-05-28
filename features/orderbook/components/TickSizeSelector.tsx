'use client'

import { TICK_SIZE_OPTIONS, type TickSize } from '../constants'

interface Props {
  value: TickSize
  onChange: (value: TickSize) => void
}

/**
 * Tick size 聚合下拉。原生 select，无障碍由浏览器原生支持。
 */
export default function TickSizeSelector({ value, onChange }: Props) {
  return (
    <label className="flex items-center gap-1 text-xs text-[#8698aa] cursor-pointer">
      <span>Group</span>
      <select
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) as TickSize)}
        aria-label="Aggregation tick size"
        className="bg-[#1E3059] text-[#F0F4F8] text-xs rounded px-1 py-0.5 outline-none cursor-pointer"
      >
        {TICK_SIZE_OPTIONS.map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    </label>
  )
}
