"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GateStatus, Readiness } from "@/lib/readiness/gates";

/**
 * The gate panel on a subsystem page.
 *
 * Every state says what it is waiting on, in words, because the number at the
 * top is only trustworthy if a person can see what it is made of. The old
 * percentage was a part count nobody could interrogate; eight gates with a
 * sentence each is the whole point of the change.
 *
 * Colour follows the app's telemetry palette and never carries meaning alone:
 * each gate also states its condition in text, and the icons are words, not
 * glyphs.
 */

const STATE_STYLE: Record<string, { dot: string; label: string; text: string }> = {
  PASSED: { dot: "#2ED573", label: "CLOSED", text: "text-graphite-200" },
  ENDORSED: { dot: "#3DA9FC", label: "ENDORSED", text: "text-graphite-200" },
  READY: { dot: "#FFB020", label: "READY", text: "text-graphite-200" },
  OPEN: { dot: "#5C676B", label: "OPEN", text: "text-graphite-300" },
  BLOCKED: { dot: "#2E5C67", label: "BLOCKED", text: "text-graphite-500" },
  NOT_APPLICABLE: { dot: "#3A4449", label: "N/A", text: "text-graphite-500" }
};

export interface GatePanelProps {
  subsystemId: string;
  readiness: Readiness;
  /** What the signed-in person is allowed to attempt. The server decides again. */
  canEndorse: boolean;
  canApprove: boolean;
  partListDeclaredComplete: boolean;
}

export function GatePanel({
  subsystemId,
  readiness,
  canEndorse,
  canApprove,
  partListDeclaredComplete
}: GatePanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ gate: string; kind: "endorse" | "na" | "reopen"; label: string } | null>(null);
  const [text, setText] = useState("");

  async function post(body: Record<string, unknown>) {
    setError(null);
    setBusy(String(body.gate ?? body.action));
    const res = await fetch(`/api/subsystems/${subsystemId}/gates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // The server sends a sentence, not a status code. Show it.
      setError(typeof data.error === "string" ? data.error : "Could not record that.");
      return false;
    }
    setPrompt(null);
    setText("");
    router.refresh();
    return true;
  }

  const ceiling = readiness.ceiling;

  return (
    <section className="panel p-6 space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-medium text-graphite-200">Completeness</h2>
          <p className="text-[11px] text-graphite-500 mt-1 max-w-lg leading-relaxed">
            Eight gates, each signed off by a person. The data says when a gate is ready; a lead
            endorses it and the Chief Engineer closes it.
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl tabular-nums text-graphite-100">{readiness.pct}%</div>
          <div className="font-mono text-[11px] text-graphite-500">
            {readiness.passed} of {readiness.applicable} gates closed
          </div>
        </div>
      </header>

      {/* A binding ceiling is the most important thing on the page: the gates
          say one thing and the car says another. */}
      {ceiling && (
        <div className="rounded border border-telemetry-amber/40 bg-telemetry-amber/[0.06] px-4 py-3">
          <div className="font-mono text-[10px] text-telemetry-amber">
            CAPPED AT {ceiling.cap}% — GATES ALONE WOULD SAY {readiness.gatePct}%
          </div>
          <p className="text-xs text-graphite-300 mt-1.5 leading-relaxed">{ceiling.reason}</p>
        </div>
      )}

      {readiness.stale.length > 0 && (
        <div className="rounded border border-telemetry-red/40 bg-telemetry-red/[0.06] px-4 py-3">
          <div className="font-mono text-[10px] text-telemetry-red">
            {readiness.stale.length === 1
              ? "1 CLOSED GATE NO LONGER MATCHES THE DATA"
              : `${readiness.stale.length} CLOSED GATES NO LONGER MATCH THE DATA`}
          </div>
          <ul className="mt-1.5 space-y-1">
            {readiness.stale.map((g) => (
              <li key={g.gate} className="text-xs text-graphite-300 leading-relaxed">
                <span className="text-graphite-100">{g.label}</span> — {g.staleReason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded border border-telemetry-red/40 px-4 py-3 text-xs text-telemetry-red leading-relaxed">
          {error}
        </div>
      )}

      {/* SCOPED derives from this, and it is the gate that fixes the old
          denominator — so the control for it sits right here rather than being
          buried in a settings page. */}
      {canEndorse && (
        <label className="flex items-start gap-2.5 rounded border border-graphite-800 px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={partListDeclaredComplete}
            disabled={busy === "declare-scope"}
            onChange={(e) => post({ action: "declare-scope", complete: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs text-graphite-200">The part list for this subsystem is complete</span>
            <span className="block text-[11px] text-graphite-500 mt-0.5 leading-relaxed">
              Everything this subsystem needs is entered, including parts nobody has started. No
              percentage means anything until this is true — a list you can shorten is a score you
              can inflate.
            </span>
          </span>
        </label>
      )}

      <ol className="space-y-2">
        {readiness.gates.map((g) => (
          <GateRow
            key={g.gate}
            gate={g}
            busy={busy === g.gate}
            canEndorse={canEndorse}
            canApprove={canApprove}
            onEndorse={() =>
              g.requiresEvidence
                ? setPrompt({ gate: g.gate, kind: "endorse", label: g.label })
                : post({ action: "endorse", gate: g.gate })
            }
            onApprove={() => post({ action: "approve", gate: g.gate })}
            onNa={() => setPrompt({ gate: g.gate, kind: "na", label: g.label })}
            onReopen={() => setPrompt({ gate: g.gate, kind: "reopen", label: g.label })}
          />
        ))}
      </ol>

      {prompt && (
        <div className="rounded border border-signal/40 px-4 py-3 space-y-2">
          <div className="font-mono text-[10px] text-signal">
            {prompt.kind === "endorse" && `EVIDENCE FOR ${prompt.label.toUpperCase()}`}
            {prompt.kind === "na" && `WHY IS ${prompt.label.toUpperCase()} OUT OF SCOPE?`}
            {prompt.kind === "reopen" && `WHY REOPEN ${prompt.label.toUpperCase()}?`}
          </div>
          <p className="text-[11px] text-graphite-500 leading-relaxed">
            {prompt.kind === "endorse" &&
              "What was checked, and how. This is a gate the design judges ask about, so write it for them."}
            {prompt.kind === "na" &&
              "Shown on this page next to the gate, and it leaves the gate out of the percentage. An unexplained N/A is indistinguishable from hiding work."}
            {prompt.kind === "reopen" && "Goes into the gate history and cannot be edited later."}
          </p>
          <textarea
            className="input min-h-20 w-full"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              prompt.kind === "endorse"
                ? "e.g. Scatter shield checked against T.5.2.7 — 2.8 mm steel, verified with calipers, photo attached to the subsystem documents"
                : "e.g. no track time available this season"
            }
          />
          <div className="flex gap-2">
            <button
              className="btn-primary text-xs"
              disabled={!!busy}
              onClick={() =>
                post(
                  prompt.kind === "endorse"
                    ? { action: "endorse", gate: prompt.gate, note: text }
                    : prompt.kind === "na"
                      ? { action: "not-applicable", gate: prompt.gate, reason: text }
                      : { action: "reopen", gate: prompt.gate, reason: text }
                )
              }
            >
              {prompt.kind === "endorse" ? "Endorse" : prompt.kind === "na" ? "Mark out of scope" : "Reopen"}
            </button>
            <button className="btn-ghost text-xs" onClick={() => { setPrompt(null); setText(""); setError(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function GateRow({
  gate,
  busy,
  canEndorse,
  canApprove,
  onEndorse,
  onApprove,
  onNa,
  onReopen
}: {
  gate: GateStatus;
  busy: boolean;
  canEndorse: boolean;
  canApprove: boolean;
  onEndorse: () => void;
  onApprove: () => void;
  onNa: () => void;
  onReopen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const style = STATE_STYLE[gate.state];

  return (
    <li className={`rounded border px-4 py-3 ${gate.stale ? "border-telemetry-red/40" : "border-graphite-800"}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: style.dot }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span className={`text-sm ${style.text}`}>{gate.label}</span>
            <span className="font-mono text-[10px] text-graphite-500">{style.label}</span>
            {gate.stale && <span className="font-mono text-[10px] text-telemetry-red">DATA CHANGED</span>}
            {gate.requiresEvidence && gate.state !== "PASSED" && (
              <span className="font-mono text-[10px] text-graphite-600">EVIDENCE NEEDED</span>
            )}
          </div>
          <p className="text-[11px] text-graphite-400 mt-1 leading-relaxed">{gate.detail}</p>

          {(gate.endorsedBy || gate.approvedBy) && (
            <p className="font-mono text-[10px] text-graphite-600 mt-1">
              {gate.endorsedBy && `endorsed ${gate.endorsedAt?.slice(0, 10) ?? ""}`}
              {gate.endorsedBy && gate.approvedBy && " · "}
              {gate.approvedBy && `approved ${gate.approvedAt?.slice(0, 10) ?? ""}`}
            </p>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-[10px] text-graphite-600 hover:text-signal mt-1.5"
          >
            {open ? "hide what this means" : "what does closing this mean?"}
          </button>
          {open && <p className="text-[11px] text-graphite-400 mt-1.5 leading-relaxed">{gate.means}</p>}
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          {canEndorse && (gate.state === "READY" || gate.state === "OPEN") && (
            <button className="btn-ghost text-[11px] py-1" disabled={busy} onClick={onEndorse}>
              Endorse
            </button>
          )}
          {canApprove && gate.state === "ENDORSED" && (
            <button className="btn-primary text-[11px] py-1" disabled={busy} onClick={onApprove}>
              Approve
            </button>
          )}
          {canApprove && gate.state === "PASSED" && (
            <button className="btn-ghost text-[11px] py-1" disabled={busy} onClick={onReopen}>
              Reopen
            </button>
          )}
          {canApprove && gate.state !== "PASSED" && gate.state !== "NOT_APPLICABLE" && gate.gate !== "SCOPED" && (
            <button className="btn-ghost text-[11px] py-1" disabled={busy} onClick={onNa}>
              Out of scope
            </button>
          )}
          {canApprove && gate.state === "NOT_APPLICABLE" && (
            <button className="btn-ghost text-[11px] py-1" disabled={busy} onClick={onReopen}>
              Back in scope
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
