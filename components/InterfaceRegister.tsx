"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { InterfaceRow } from "@/lib/interfaces";
import { formatDay } from "@/lib/datetime";

/**
 * The interface register.
 *
 * An interface is the one record here that belongs to nobody: two subsystems
 * meet at it, both are held by it, and it only closes when BOTH leads agree.
 * The screen is built around making the second signature the obvious next
 * action, because "one side has signed and is waiting" is the state where
 * these actually stall.
 *
 * Each row shows both sides explicitly rather than a single status word. A
 * status field saying AGREED tells you nothing about who agreed, which is how
 * a joint ends up closed in the register and open in reality.
 */

const PRIORITY_STYLE: Record<string, string> = {
  P1: "border-telemetry-red/50 text-telemetry-red",
  P2: "border-telemetry-amber/50 text-telemetry-amber",
  P3: "border-graphite-600 text-graphite-400"
};

export function InterfaceRegister({
  interfaces,
  subsystems,
  currentUserId,
  canRaise,
  ledSubsystemIds,
  isChief
}: {
  interfaces: InterfaceRow[];
  subsystems: Array<{ id: string; name: string }>;
  currentUserId: string;
  canRaise: boolean;
  ledSubsystemIds: string[];
  isChief: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function agree(ref: string) {
    setBusy(ref);
    setError(null);
    const res = await fetch("/api/interfaces/agree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interface_ref: ref })
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not agree that interface.");
      return;
    }
    router.refresh();
  }

  /** Which side, if any, this person is entitled to sign. */
  function mySide(i: InterfaceRow): "a" | "b" | null {
    if (i.subsystem_a_id && ledSubsystemIds.includes(i.subsystem_a_id)) return "a";
    if (i.subsystem_b_id && ledSubsystemIds.includes(i.subsystem_b_id)) return "b";
    return null;
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded border border-telemetry-red/40 px-4 py-3 text-xs text-telemetry-red leading-relaxed">
          {error}
        </div>
      )}

      {canRaise && (
        <div>
          {showNew ? (
            <NewInterfaceForm
              subsystems={subsystems}
              onDone={() => {
                setShowNew(false);
                router.refresh();
              }}
              onCancel={() => setShowNew(false)}
              onError={setError}
            />
          ) : (
            <button className="btn-primary text-xs" onClick={() => setShowNew(true)}>
              + Raise an interface
            </button>
          )}
        </div>
      )}

      {interfaces.length === 0 ? (
        <div className="panel p-6">
          <p className="text-sm text-graphite-300 leading-relaxed max-w-prose">
            Nothing in the register yet. An interface is any place two subsystems physically meet —
            engine mounts to the rear bulkhead, wishbone pickups to the frame, the pedal box to the
            floor. Raise them early: they are where cars fail to go together, because no single
            subsystem owns them.
          </p>
          <p className="text-[11px] text-graphite-500 mt-3 leading-relaxed max-w-prose">
            Every subsystem&rsquo;s <strong className="text-graphite-300">Interfaces agreed</strong> gate
            reads this register, and an unagreed critical interface caps that subsystem at 84%.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {interfaces.map((i) => {
            const bothAgreed = !!i.agreed_by_a && !!i.agreed_by_b;
            const side = mySide(i);
            const alreadySigned =
              (side === "a" && !!i.agreed_by_a) || (side === "b" && !!i.agreed_by_b);
            const canSign = (!!side && !alreadySigned) || (isChief && !bothAgreed);

            return (
              <li
                key={i.id}
                className={`panel p-4 ${
                  i.priority === "P1" && !bothAgreed ? "border-l-2 border-l-telemetry-red" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-[11px] text-graphite-400">{i.interface_ref}</span>
                      <span className={`pill ${PRIORITY_STYLE[i.priority] ?? PRIORITY_STYLE.P3}`}>
                        {i.priority}
                        {i.priority === "P1" ? " · critical" : ""}
                      </span>
                      {bothAgreed && (
                        <span className="pill border-telemetry-green/50 text-telemetry-green">AGREED</span>
                      )}
                    </div>

                    <p className="text-sm text-graphite-100 mt-1.5 leading-relaxed">{i.description}</p>
                    {i.driver && (
                      <p className="text-[11px] text-graphite-500 mt-1">Driven by: {i.driver}</p>
                    )}

                    {/* Both sides, explicitly. A single AGREED status word tells
                        you nothing about WHO agreed, which is how a joint ends
                        up closed in the register and open in reality. */}
                    <div className="grid sm:grid-cols-2 gap-2 mt-3">
                      <SideCard
                        name={i.subsystem_a_name}
                        agreedBy={i.agreed_a_name}
                        at={(i as any).agreed_a_at}
                      />
                      <SideCard
                        name={i.subsystem_b_name}
                        agreedBy={i.agreed_b_name}
                        at={(i as any).agreed_b_at}
                      />
                    </div>

                    {i.due_date && (
                      <p className="font-mono text-[11px] text-graphite-500 mt-2">due {i.due_date}</p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {canSign && (
                      <button
                        className="btn-primary text-[11px] py-1"
                        disabled={busy === i.interface_ref}
                        onClick={() => agree(i.interface_ref)}
                      >
                        {busy === i.interface_ref ? "…" : "Agree my side"}
                      </button>
                    )}
                    {alreadySigned && !bothAgreed && (
                      <span className="font-mono text-[10px] text-telemetry-amber text-right max-w-[9rem]">
                        YOU HAVE SIGNED — WAITING ON THE OTHER LEAD
                      </span>
                    )}
                    {!side && !isChief && !bothAgreed && (
                      <span className="font-mono text-[10px] text-graphite-600 text-right max-w-[9rem]">
                        ONLY THE TWO LEADS CAN AGREE THIS
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SideCard({
  name,
  agreedBy,
  at
}: {
  name: string | null;
  agreedBy: string | null;
  at?: string | null;
}) {
  return (
    <div
      className={`rounded border px-3 py-2 ${
        agreedBy ? "border-telemetry-green/40" : "border-graphite-800"
      }`}
    >
      <div className="text-xs text-graphite-200">{name ?? "Unassigned subsystem"}</div>
      <div className="font-mono text-[10px] mt-0.5">
        {agreedBy ? (
          <span className="text-telemetry-green">
            agreed by {agreedBy}
            {at ? ` · ${formatDay(String(at), "")}` : ""}
          </span>
        ) : (
          <span className="text-graphite-500">not agreed</span>
        )}
      </div>
    </div>
  );
}

function NewInterfaceForm({
  subsystems,
  onDone,
  onCancel,
  onError
}: {
  subsystems: Array<{ id: string; name: string }>;
  onDone: () => void;
  onCancel: () => void;
  onError: (s: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    onError(null);
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    const res = await fetch("/api/interfaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(typeof data.error === "string" ? data.error : "Could not raise that interface.");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="panel p-5 space-y-4">
      <div>
        <div className="data-label">RAISE AN INTERFACE</div>
        <p className="text-[11px] text-graphite-500 mt-1 leading-relaxed max-w-prose">
          The reference number is generated from the two subsystem codes, so the same pair always
          reads the same way round.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="data-label block mb-1">First subsystem</span>
          <select className="input w-full" name="subsystem_a_id" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="data-label block mb-1">Second subsystem</span>
          <select className="input w-full" name="subsystem_b_id" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="data-label block mb-1">What meets what</span>
        <textarea
          className="input min-h-20 w-full"
          name="description"
          required
          placeholder="e.g. Engine rear mounts bolt to the rear bulkhead — 4x M10, shared load path into the main hoop bracing"
        />
        <span className="block text-[11px] text-graphite-600 mt-1 leading-relaxed">
          Be specific enough that both leads are agreeing to the same thing. &ldquo;Engine to
          chassis&rdquo; is not an interface definition.
        </span>
      </label>

      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="data-label block mb-1">Priority</span>
          <select className="input w-full" name="priority" defaultValue="P2">
            <option value="P1">P1 — critical, the car does not assemble without it</option>
            <option value="P2">P2 — important</option>
            <option value="P3">P3 — minor</option>
          </select>
        </label>
        <label className="block">
          <span className="data-label block mb-1">Driven by</span>
          <input className="input w-full" name="driver" placeholder="Rule, SES, packaging…" />
        </label>
        <label className="block">
          <span className="data-label block mb-1">Due</span>
          <input className="input w-full" type="date" name="due_date" />
        </label>
      </div>

      <p className="text-[11px] text-graphite-500 leading-relaxed">
        A <strong className="text-graphite-300">P1</strong> left unagreed caps both subsystems at 84%,
        however much of their own work is done. Use it for joints that stop the car going together.
      </p>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary text-xs" disabled={saving}>
          {saving ? "Raising…" : "Raise interface"}
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
