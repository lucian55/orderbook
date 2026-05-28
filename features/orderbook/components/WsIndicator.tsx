import { WsHealthStatus, WS_STATUS } from '../types'

interface Props {
  status: WsHealthStatus
}

const STATUS_CONFIG = {
  [WS_STATUS.CONNECTING]: { dot: 'bg-yellow-400', label: 'Connecting'          },
  [WS_STATUS.TIMEOUT]:    { dot: 'bg-orange-400', label: 'Reconnecting'        },
  [WS_STATUS.FAILED]:     { dot: 'bg-red-500',    label: 'Disconnected' },
} as const

/**
 * WS 连接状态指示器，仅在非健康状态下显示。
 * healthy 时返回 null，不占用布局空间。
 */
export default function WsIndicator({ status }: Props) {
  if (status === WS_STATUS.HEALTHY || status === WS_STATUS.CONNECTING) return null

  const { dot, label } = STATUS_CONFIG[status]

  return (
    <div className="flex items-center gap-1.5 text-xs text-[#8698aa]">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span>{label}</span>
    </div>
  )
}
