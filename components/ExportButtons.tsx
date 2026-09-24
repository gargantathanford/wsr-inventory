"use client";

export function ExportButtons({ filters }: { filters: Record<string, string | undefined> }) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);

  function exportAs(format: "csv" | "xlsx") {
    const params = new URLSearchParams(qs);
    params.set("format", format);
    window.location.href = `/api/parts/export?${params.toString()}`;
  }

  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => exportAs("csv")} className="btn-ghost text-xs">
        Export CSV
      </button>
      <button type="button" onClick={() => exportAs("xlsx")} className="btn-ghost text-xs">
        Export Excel
      </button>
      <button type="button" onClick={() => window.print()} className="btn-ghost text-xs">
        Print
      </button>
    </div>
  );
}
