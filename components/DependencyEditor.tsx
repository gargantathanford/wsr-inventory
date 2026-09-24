"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DependencyEditor({
  partId,
  allParts,
  currentDependencyIds
}: {
  partId: string;
  allParts: { id: string; part_name: string }[];
  currentDependencyIds: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = allParts.filter((p) => p.id !== partId && !currentDependencyIds.includes(p.id));

  async function addDependency() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/parts/${partId}/dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depends_on_part_id: selected })
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not add dependency.");
      return;
    }
    setSelected("");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-telemetry-red font-mono">{error}</span>}
      <select className="input text-xs py-1.5 w-56" value={selected} onChange={(e) => setSelected(e.target.value)}>
        <option value="">Add a required part…</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.part_name}
          </option>
        ))}
      </select>
      <button type="button" onClick={addDependency} disabled={!selected || loading} className="btn-ghost text-xs py-1.5">
        {loading ? "Adding…" : "Add"}
      </button>
    </div>
  );
}

export function RemoveDependencyButton({ partId, dependsOnId }: { partId: string; dependsOnId: string }) {
  const router = useRouter();
  async function onClick() {
    await fetch(`/api/parts/${partId}/dependencies?depends_on_part_id=${dependsOnId}`, { method: "DELETE" });
    router.refresh();
  }
  return (
    <button onClick={onClick} className="text-xs text-graphite-600 hover:text-telemetry-red ml-2">
      remove
    </button>
  );
}
