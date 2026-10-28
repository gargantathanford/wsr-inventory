"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface RuleHit {
  id: string;
  clause_id: string;
  section: string;
  depth: number;
  heading: string;
  body: string | null;
}

export interface Citation {
  id: string;
  clause_id: string;
  heading: string;
  body: string | null;
  section: string;
  note: string | null;
  ruleset_label: string;
}

/**
 * Type-to-search rule citation picker.
 *
 * A dropdown is the wrong control here: the 2027 ruleset has 1,825 clauses. The
 * point of this component is that a lead stops needing to remember that scatter
 * shields are T.5.2.7 — they type "scatter shield" and pick it. Clause text is
 * shown inline so the choice can be checked without opening the PDF.
 */
export function RuleCitationPicker({
  partId,
  citations,
  canEdit
}: {
  partId: string;
  citations: Citation[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RuleHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const cited = new Set(citations.map((c) => c.clause_id));

  const search = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/rules?q=${encodeURIComponent(q)}&limit=25`);
      const data = await res.json().catch(() => ({}));
      setHits(data.rules ?? []);
      // The API says so explicitly when no ruleset is loaded, so the picker can
      // explain itself instead of looking broken.
      setNotice(data.notice ?? null);
    } catch {
      setHits([]);
      setError("Could not reach the rule search.");
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced so typing a clause number does not fire a request per keystroke.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(query), 200);
    return () => clearTimeout(t);
  }, [query, open, search]);

  // Close on an outside click, so the panel does not sit over the form.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function cite(clauseId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/parts/${partId}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clause_id: clauseId })
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not add that citation.");
      return;
    }
    setQuery("");
    setOpen(false);
    router.refresh();
  }

  async function uncite(citationId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/parts/${partId}/rules?citation=${encodeURIComponent(citationId)}`, {
      method: "DELETE"
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not remove that citation.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {citations.length === 0 ? (
        <p className="text-xs text-graphite-500">
          No rule cited. A part that must satisfy an FSAE requirement should name the clause — it is what tech
          inspection checks against.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {citations.map((c) => (
            <li key={c.id} className="rounded border border-graphite-800 bg-graphite-900/40">
              <div className="flex items-start gap-2 px-3 py-2">
                <span className="font-mono text-xs text-signal shrink-0 pt-0.5">{c.clause_id}</span>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  className="flex-1 text-left text-xs text-graphite-200 hover:text-graphite-100"
                  title="Show the clause text"
                >
                  {c.heading}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => uncite(c.id)}
                    disabled={busy}
                    className="text-xs text-graphite-500 hover:text-telemetry-red shrink-0"
                    aria-label={`Remove citation ${c.clause_id}`}
                  >
                    remove
                  </button>
                )}
              </div>
              {expanded === c.id && c.body && (
                <p className="px-3 pb-3 text-xs leading-relaxed text-graphite-400 border-t border-graphite-800 pt-2">
                  {c.body}
                  <span className="block mt-2 font-mono text-[10px] text-graphite-600">{c.ruleset_label}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-telemetry-red font-mono">{error}</p>}

      {canEdit && (
        <div ref={boxRef} className="relative">
          <input
            className="input text-xs py-1.5 w-full"
            placeholder="Cite a rule — type a clause number or what it covers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
          />

          {open && (
            <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded border border-graphite-700 bg-graphite-950 shadow-lg">
              {notice ? (
                <p className="px-3 py-3 text-xs text-graphite-400">{notice}</p>
              ) : searching && hits.length === 0 ? (
                <p className="px-3 py-3 text-xs text-graphite-500">Searching…</p>
              ) : hits.length === 0 ? (
                <p className="px-3 py-3 text-xs text-graphite-500">
                  Nothing matches {query ? `“${query}”` : "that"}. Try a clause number like T.5.2, or a phrase from the
                  rule.
                </p>
              ) : (
                <ul className="divide-y divide-graphite-800">
                  {hits.map((h) => {
                    const already = cited.has(h.clause_id);
                    return (
                      <li key={h.id}>
                        <button
                          type="button"
                          disabled={already || busy}
                          onClick={() => cite(h.clause_id)}
                          className={`w-full text-left px-3 py-2 ${
                            already ? "opacity-40 cursor-default" : "hover:bg-graphite-900"
                          }`}
                        >
                          <span className="flex items-baseline gap-2">
                            <span className="font-mono text-xs text-signal shrink-0">{h.clause_id}</span>
                            <span className="text-xs text-graphite-200">{h.heading}</span>
                            {already && (
                              <span className="ml-auto font-mono text-[10px] text-graphite-500 shrink-0">cited</span>
                            )}
                          </span>
                          {h.body && h.body.length > h.heading.length + 8 && (
                            <span className="mt-1 block text-[11px] leading-snug text-graphite-500 line-clamp-2">
                              {h.body}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
