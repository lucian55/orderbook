import { BtseWsClient } from '@/shared/websocket/BtseWsClient'
import { OrderBookMessage, MSG_TYPE } from '../types'

// 单例：整个应用共享一个 WS 连接
const client = new BtseWsClient<OrderBookMessage>({
  url: 'wss://ws.btse.com/ws/oss/futures',
  subscribeArgs: ['update:BTCPFC'],
  parseMessage: (raw: unknown) => {
    const msg = raw as OrderBookMessage
    if (msg?.data?.type === MSG_TYPE.SNAPSHOT || msg?.data?.type === MSG_TYPE.DELTA) {
      return msg
    }
    return null
  },
})

export function getBtseOrderBookClient() {
  return client
}
