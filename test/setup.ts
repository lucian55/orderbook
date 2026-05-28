import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// 每个用例结束后卸载所有渲染的组件，防止 timer/effect 跨用例泄漏
afterEach(() => {
  cleanup()
})
