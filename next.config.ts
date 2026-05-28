import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * BTSE REST 接口直接从浏览器调用会被 Cloudflare 返回 403（CORS / 风控）。
   * 通过 Next.js 的 rewrites 把 /btse-api/* 反向代理到真实域名，
   * 浏览器看到的是同源请求，不再被拦截。
   *
   *   /btse-api/orderbook?...   →   https://api.btse.com/futures/api/v2.1/orderbook?...
   *   /btse-api/price?...       →   https://api.btse.com/futures/api/v2.1/price?...
   */
  async rewrites() {
    return [
      {
        source: '/btse-api/:path*',
        destination: 'https://api.btse.com/spot/api/v3.2/:path*',
      },
    ]
  },
}

export default nextConfig
