export function StatCard({
  label,
  value,
  suffix,
  accent = "text-graphite-100",
  sub
}: {
  label: string;
  value: string | number;
  suffix?: string;
  accent?: string;
  sub?: string;
}) {
  return (
    <div className="panel p-5">
      <div className="data-label">{label}</div>
      <div className={`stat-figure mt-2 ${accent}`}>
        {value}
        {suffix && <span className="text-lg text-graphite-500 ml-1">{suffix}</span>}
      </div>
      {sub && <div className="text-xs text-graphite-500 mt-1 font-mono">{sub}</div>}
    </div>
  );
}
