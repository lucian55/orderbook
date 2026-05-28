'use client'

import dynamic from "next/dynamic";

const OrderBook = dynamic(
  () => import("@/features/orderbook"),
  { ssr: false }
);

export default function Page() {
  return (
    <main className="min-h-screen bg-[#131B29] flex items-start justify-center p-8">
      <OrderBook />
    </main>
  );
}
