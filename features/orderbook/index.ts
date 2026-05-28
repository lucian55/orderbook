// 对外只暴露主组件，feature 内部其它模块都视为实现细节。
// app/page.tsx 通过 `import OrderBook from '@/features/orderbook'` 拿到。
export { default } from './components/OrderBook'
