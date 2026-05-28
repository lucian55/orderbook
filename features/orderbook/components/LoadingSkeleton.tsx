const WIDTHS = ['40%', '55%', '35%', '60%', '45%', '50%', '38%', '52%']

export default function LoadingSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-2 px-2" style={{ height: 28 }}>
          <div
            className="h-2.5 rounded bg-[#1E3059] animate-pulse"
            style={{ width: WIDTHS[i % WIDTHS.length] }}
          />
          <div className="ml-auto h-2.5 w-16 rounded bg-[#1E3059] animate-pulse" />
          <div className="h-2.5 w-16 rounded bg-[#1E3059] animate-pulse" />
        </li>
      ))}
    </ul>
  )
}
