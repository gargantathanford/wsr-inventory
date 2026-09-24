import Link from "next/link";
import { getAllParts, getAllSubsystems } from "@/lib/queries";
import { PartsTable } from "@/components/PartsTable";
import { ExportButtons } from "@/components/ExportButtons";

const STATUSES = [
  "OWNED",
  "PARTIALLY_OWNED",
  "NEEDED",
  "ORDERED",
  "BACKORDERED",
  "MANUFACTURING",
  "AVAILABLE_FOR_INSTALLATION",
  "INSTALLED",
  "UNAVAILABLE",
  "NO_LONGER_NEEDED"
];
const IMPORTANCE = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export default async function PartsPage({
  searchParams
}: {
  searchParams: { q?: string; subsystem?: string; status?: string; importance?: string };
}) {
  const subsystems = getAllSubsystems();
  const parts = getAllParts({
    subsystemId: searchParams.subsystem || undefined,
    status: searchParams.status || undefined,
    importance: searchParams.importance || undefined,
    search: searchParams.q || undefined
  });

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="data-label">PARTS DATABASE</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{parts.length} parts</h1>
        </div>
        <Link href="/parts/new" className="btn-primary">
          + New part
        </Link>
      </div>

      <ExportButtons
        filters={{
          subsystem: searchParams.subsystem,
          status: searchParams.status,
          importance: searchParams.importance
        }}
      />

      <form className="panel p-4 grid sm:grid-cols-4 gap-3" method="get">
        <input className="input" type="text" name="q" placeholder="Search parts…" defaultValue={searchParams.q} />
        <select className="input" name="subsystem" defaultValue={searchParams.subsystem || ""}>
          <option value="">All subsystems</option>
          {subsystems.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="input" name="status" defaultValue={searchParams.status || ""}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select className="input" name="importance" defaultValue={searchParams.importance || ""}>
          <option value="">All importance</option>
          {IMPORTANCE.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <div className="sm:col-span-4 flex gap-2">
          <button type="submit" className="btn-primary">
            Apply filters
          </button>
          <Link href="/parts" className="btn-ghost">
            Clear
          </Link>
        </div>
      </form>

      <PartsTable parts={parts} showSubsystem />
    </div>
  );
}
