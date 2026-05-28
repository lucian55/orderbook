import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    // hook/组件测试需要 DOM；纯函数测试在 jsdom 下也能跑
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // e2e/ 由 Playwright 跑，vitest 跳过
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
