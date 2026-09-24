export function ProgressBar({
  pct,
  colorClass = "bg-signal",
  height = "h-1.5"
}: {
  pct: number;
  colorClass?: string;
  height?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`w-full ${height} bg-graphite-800 rounded-full overflow-hidden`}>
      <div
        className={`${height} ${colorClass} rounded-full transition-all`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
