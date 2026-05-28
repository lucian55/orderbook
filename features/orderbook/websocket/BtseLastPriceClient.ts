import { BtseWsClient } from '@/shared/websocket/BtseWsClient'
import { TradeHistoryMessage } from '../types'

// 现货回包的 topic 包含交易对后缀（与合约不同）
const SUBSCRIBE_ARG = 'tradeHistoryApi:BTC-USD'
const MESSAGE_TOPIC = 'tradeHistoryApi:BTC-USD'

// 单例：整个应用共享一个 WS 连接
const client = new BtseWsClient<TradeHistoryMessage>({
  url: 'wss://ws.btse.com/ws/spot',
  subscribeArgs: [SUBSCRIBE_ARG],
  parseMessage: (raw: unknown) => {
    const msg = raw as TradeHistoryMessage
    if (msg?.topic === MESSAGE_TOPIC && Array.isArray(msg?.data) && msg.data.length > 0) {
      return msg
    }
    return null
  },
})

export function getBtseLastPriceClient() {
  return client
}
