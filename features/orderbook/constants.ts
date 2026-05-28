/** 买卖各侧可见报价条数，hook 和 SideList 共用 */
export const MAX_VISIBLE_QUOTES = 8

/**
 * Tick size 聚合选项。0.1 是 BTCPFC 原始最小精度，其它档位为价格聚合。
 *
 * 注意：BTSE 的 update:BTCPFC topic 只推送约 50 档原始数据，
 * 跨度通常只有十几美元，tick 过大会导致桶数不足 8 行（出现空行）。
 * 所以这里只保留实际能凑满或接近凑满 8 行的档位。
 */
export const TICK_SIZE_OPTIONS = [0.1, 0.5, 1] as const

export type TickSize = typeof TICK_SIZE_OPTIONS[number]

export const DEFAULT_TICK_SIZE: TickSize = 0.1
