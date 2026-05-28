const RECONNECT_INTERVAL = 3_000 // 断线后等 3s 重连，避免立即重连打爆服务器
const MAX_RECONNECT = 10 // 最多重试 10 次，防止无限循环
const HEARTBEAT_INTERVAL = 5_000 // BTSE 服务端 ~9s 无消息会主动断开，5s ping 保活

export interface BtseWsConfig<T> {
  url: string
  subscribeArgs: string[]
  /** 解析原始消息，返回 null 表示忽略该消息 */
  parseMessage: (raw: unknown) => T | null
  /** 超过最大重连次数后的回调 */
  onGiveUp?: () => void
}

/**
 * 通用 BTSE WebSocket 客户端。
 * 封装连接、心跳、自动重连等共用逻辑；
 * 业务层通过 parseMessage 决定哪些消息需要派发。
 */
export class BtseWsClient<T> {
  private ws: WebSocket | null = null
  private handlers: Set<(msg: T) => void> = new Set()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectAttempts = 0
  private isManualClose = false // 区分主动关闭和意外断线，防止主动关闭触发重连
  private readonly config: BtseWsConfig<T>

  constructor(config: BtseWsConfig<T>) {
    this.config = config
  }

  /** 建立 WebSocket 连接并注册事件处理器 */
  private connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING)
      return

    this.ws = new WebSocket(this.config.url)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.send({ op: 'subscribe', args: this.config.subscribeArgs })
      this.startHeartbeat()
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = JSON.parse(event.data as string)
        // 服务端主动发 ping 时需回 pong，否则服务端可能断开连接
        if (raw?.event === 'ping') {
          this.send({ op: 'pong' })
          return
        }
        const msg = this.config.parseMessage(raw)
        if (msg !== null) {
          this.handlers.forEach(h => h(msg))
        }
      } catch {
        // 忽略格式异常的消息
      }
    }

    this.ws.onclose = () => {
      this.stopHeartbeat()
      if (!this.isManualClose) this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onerror 之后必然触发 onclose，由 onclose 统一处理重连
    }
  }

  /** 安全发送：仅在连接 OPEN 时发送，避免抛出异常 */
  private send(payload: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: 'ping' })
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** 延迟后重连，超过最大次数则触发 onGiveUp 并停止 */
  private scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT) {
      this.config.onGiveUp?.()
      return
    }
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_INTERVAL)
  }

  /** 注册消息处理器，返回取消订阅函数；首次调用时自动建立连接 */
  subscribe(handler: (msg: T) => void): () => void {
    this.handlers.add(handler)
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.isManualClose = false
      this.connect()
    }
    return () => this.handlers.delete(handler)
  }

  /** 强制重新订阅：关闭当前连接并立即重连，用于 seqNum 断层或超时恢复 */
  resubscribe() {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      // 解绑 onclose，防止旧 ws 的异步 close 回调进入"非主动关闭"分支
      // 而触发多余的 scheduleReconnect + reconnectAttempts++
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.close()
      this.ws = null
    }
    this.isManualClose = false
    this.reconnectAttempts = 0
    this.connect()
  }

  /**
   * 软重订阅：在当前连接上重发 unsubscribe + subscribe，触发服务端重推 snapshot，
   * 但不断开 WebSocket。用于 seqNum 断层等正常恢复场景，避免不必要的重连。
   * 若连接当前不可用，send 会被静默忽略；连接恢复后 onopen 会自动重新 subscribe。
   */
  softResubscribe() {
    this.send({ op: 'unsubscribe', args: this.config.subscribeArgs })
    this.send({ op: 'subscribe', args: this.config.subscribeArgs })
  }

  close() {
    this.isManualClose = true
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }
}
