import { getAllDocuments, getAllSubsystems } from "@/lib/queries";
import { getSession } from "@/lib/auth";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { DocumentCard } from "@/components/DocumentCard";

export default async function DocumentationPage({
  searchParams
}: {
  searchParams: { q?: string; subsystem?: string };
}) {
  const subsystems = getAllSubsystems();
  const documents = getAllDocuments({ search: searchParams.q, subsystemId: searchParams.subsystem });
  const user = await getSession();
  const canManage = !!user && user.role !== "TEAM_MEMBER";

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="data-label">TECHNICAL KNOWLEDGE BASE</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{documents.length} documents</h1>
        </div>
        {canManage && <DocumentUploadForm subsystems={subsystems} />}
      </div>

      <form className="panel p-4 grid sm:grid-cols-3 gap-3" method="get">
        <input className="input sm:col-span-2" type="text" name="q" placeholder="Search documentation…" defaultValue={searchParams.q} />
        <select className="input" name="subsystem" defaultValue={searchParams.subsystem || ""}>
          <option value="">All subsystems</option>
          {subsystems.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </form>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {documents.map((d: any) => (
          <div key={d.id} className="group">
            <DocumentCard doc={d} canManage={canManage} />
          </div>
        ))}
        {documents.length === 0 && (
          <div className="panel p-8 text-center text-sm text-graphite-500 sm:col-span-2 lg:col-span-3">
            No documentation found.
          </div>
        )}
      </div>
    </div>
  );
}
