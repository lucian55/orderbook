import { test, expect, type Page } from '@playwright/test'

/**
 * Mock WebSocket：用 addInitScript 在页面加载前把 window.WebSocket 替换为受控实现。
 * 测试可以通过 window.__mockWs 主动发送消息，断言 UI 的反应。
 */
async function installWsMock(page: Page) {
  await page.addInitScript(() => {
    class MockSocket extends EventTarget {
      static OPEN = 1
      static CLOSED = 3
      readyState = 0
      url: string

      constructor(url: string) {
        super()
        this.url = url
        // 异步打开，模拟真实 WS 的握手
        setTimeout(() => {
          this.readyState = 1
          this.dispatchEvent(new Event('open'))
        }, 0)
        // 暴露最新实例给测试控制
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).__mockWs = this
      }

      send() { /* swallow client sends */ }
      close() {
        this.readyState = 3
        this.dispatchEvent(new Event('close'))
      }

      // 测试用：把任意 JSON 当成服务器消息派发给页面
      _emit(payload: unknown) {
        const event = new MessageEvent('message', { data: JSON.stringify(payload) })
        this.dispatchEvent(event)
        // onmessage 兼容
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(this as any).onmessage?.(event)
      }
    }
    // 在 onopen/onmessage 属性赋值时也派发，简化实现
    Object.defineProperty(MockSocket.prototype, 'onopen', {
      set(fn) { this.addEventListener('open', fn) },
    })
    Object.defineProperty(MockSocket.prototype, 'onmessage', {
      set(fn) { this.addEventListener('message', fn) },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).WebSocket = MockSocket
  })
}

async function emit(page: Page, payload: unknown) {
  await page.evaluate((p) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__mockWs?._emit(p)
  }, payload)
}

test.describe('OrderBook', () => {
  test('renders skeleton, then bids/asks after snapshot', async ({ page }) => {
    await installWsMock(page)
    await page.goto('/')

    const region = page.getByRole('region', { name: 'Order Book' })
    await expect(region).toBeVisible()

    // 推送 snapshot
    await emit(page, {
      topic: 'update:BTCPFC',
      data: {
        type: 'snapshot',
        seqNum: 1,
        prevSeqNum: 0,
        symbol: 'BTCPFC',
        bids: [['75000.0', '1.5'], ['74999.5', '2.0']],
        asks: [['75001.0', '1.0'], ['75001.5', '2.5']],
      },
    })

    // 价格出现说明已退出 loading 并渲染列表
    await expect(region.getByText('75,000.0')).toBeVisible()
    await expect(region.getByText('75,001.0')).toBeVisible()
  })

  test('document.title reflects latest price', async ({ page }) => {
    await installWsMock(page)
    await page.goto('/')

    // 派发 lastPrice 消息（不同 WS 的 mock 会共享同一个 __mockWs 引用，
    // 实际项目中两个 client 是独立 socket，这里 mock 简化为一个）
    await emit(page, {
      topic: 'tradeHistoryApi:BTCPFC',
      data: [{
        price: 75123.5, size: 0.1, side: 'BUY',
        symbol: 'BTCPFC', tradeId: 1, timestamp: Date.now(),
      }],
    })

    await expect(page).toHaveTitle(/75,123\.5/)
  })

  test('tick size selector changes price decimals', async ({ page }) => {
    await installWsMock(page)
    await page.goto('/')

    await emit(page, {
      topic: 'update:BTCPFC',
      data: {
        type: 'snapshot',
        seqNum: 1,
        prevSeqNum: 0,
        symbol: 'BTCPFC',
        bids: [['75000.3', '1'], ['75000.5', '2'], ['75001.0', '3']],
        asks: [['75002.0', '1']],
      },
    })

    const region = page.getByRole('region', { name: 'Order Book' })
    await expect(region.getByText('75,000.3')).toBeVisible()

    // 切到 tick=1：75000.3 / 75000.5 合并到 75000
    await page.getByLabel('Aggregation tick size').selectOption('1')
    await expect(region.getByText('75,000')).toBeVisible()
    await expect(region.getByText('75,000.3')).not.toBeVisible()
  })
})
