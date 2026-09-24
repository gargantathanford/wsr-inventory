"use client";

import { useRouter } from "next/navigation";

const TYPE_LABEL: Record<string, string> = {
  SERVICE_MANUAL: "Service Manual",
  INSTALLATION_INSTRUCTIONS: "Installation Instructions",
  CAD_MODEL: "CAD Model",
  DATASHEET: "Datasheet",
  WIRING_DIAGRAM: "Wiring Diagram",
  SPREADSHEET: "Spreadsheet",
  VIDEO: "Video",
  URL: "URL",
  TECHNICAL_NOTE: "Technical Note",
  PDF: "PDF",
  OTHER: "Other"
};

function formatBytes(bytes?: number | null) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentCard({ doc, canManage, compact = false }: { doc: any; canManage: boolean; compact?: boolean }) {
  const router = useRouter();
  const href = doc.source === "UPLOAD" ? `/api/files/${doc.id}` : doc.url || "#";

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${doc.title}"?`)) return;
    await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    router.refresh();
  }

  if (compact) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="flex items-center justify-between py-3 hover:text-signal group">
        <span className="text-sm text-graphite-200 group-hover:text-signal">{doc.title}</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-graphite-500">{doc.doc_type.replace(/_/g, " ")}</span>
          {canManage && (
            <button onClick={onDelete} className="text-xs text-graphite-600 hover:text-telemetry-red">
              delete
            </button>
          )}
        </div>
      </a>
    );
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className="panel p-5 hover:border-signal/50 transition-colors block relative">
      <div className="flex items-center justify-between mb-3">
        <span className="pill border-graphite-600 text-graphite-300 bg-graphite-800">{TYPE_LABEL[doc.doc_type] || doc.doc_type}</span>
        {doc.source === "UPLOAD" && (
          <span className="pill border-telemetry-blue/50 text-telemetry-blue bg-telemetry-blue/10">FILE</span>
        )}
      </div>
      <div className="text-graphite-100 font-medium">{doc.title}</div>
      <div className="mt-2 space-y-0.5 font-mono text-[11px] text-graphite-500">
        {doc.subsystem_name && <div>{doc.subsystem_name}</div>}
        {doc.part_name && <div>Part: {doc.part_name}</div>}
        {doc.manufacturer && <div>{doc.manufacturer}</div>}
        {doc.source === "UPLOAD" && doc.file_size ? <div>{formatBytes(doc.file_size)}</div> : null}
      </div>
      {doc.notes && <div className="text-xs text-graphite-500 mt-2">{doc.notes}</div>}
      {canManage && (
        <button
          onClick={onDelete}
          className="absolute top-4 right-4 text-xs text-graphite-600 hover:text-telemetry-red opacity-0 group-hover:opacity-100"
        >
          ✕
        </button>
      )}
    </a>
  );
}
