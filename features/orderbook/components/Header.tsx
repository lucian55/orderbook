export default function Header() {
  return (
    <div className="flex items-center px-2 py-1 text-xs text-[#8698aa]">
      <span className="flex-1">Price (USD)</span>
      <span className="w-24 text-right pr-2">Size (BTC)</span>
      <span className="w-24 text-right pr-2">Total (BTC)</span>
    </div>
  )
}
