import Link from "next/link";
import { globalSearch } from "@/lib/queries";

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q || "";
  const results = q.trim() ? globalSearch(q.trim()) : null;

  const sections: { label: string; items: any[]; hrefFn: (item: any) => string }[] = results
    ? [
        { label: "PARTS", items: results.parts, hrefFn: (i) => `/parts/${i.id}` },
        { label: "TOOLS", items: results.tools, hrefFn: (i) => `/tools/${i.id}` },
        { label: "DOCUMENTATION", items: results.documents, hrefFn: (i) => `/documentation` },
        { label: "PROCEDURES", items: results.procedures, hrefFn: (i) => `/procedures/${i.id}` },
        { label: "SUBSYSTEMS", items: results.subsystems, hrefFn: (i) => `/subsystems/${i.slug}` }
      ]
    : [];

  const totalResults = sections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <div className="p-6 md:p-8 max-w-[900px] mx-auto space-y-6">
      <div>
        <div className="data-label">SEARCH</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">
          {q ? `Results for "${q}"` : "Search parts, tools, documentation, procedures, subsystems"}
        </h1>
        {results && <p className="text-sm text-graphite-500 mt-1">{totalResults} results</p>}
      </div>

      {results && (
        <div className="space-y-6">
          {sections.map(
            (sec) =>
              sec.items.length > 0 && (
                <div key={sec.label}>
                  <div className="data-label mb-2">{sec.label}</div>
                  <div className="panel divide-y divide-graphite-800">
                    {sec.items.map((item) => (
                      <Link key={item.id} href={sec.hrefFn(item)} className="block p-3.5 text-sm text-graphite-200 hover:text-signal hover:bg-graphite-850/60">
                        {item.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )
          )}
          {totalResults === 0 && <p className="text-sm text-graphite-500">No matches found.</p>}
        </div>
      )}
    </div>
  );
}
