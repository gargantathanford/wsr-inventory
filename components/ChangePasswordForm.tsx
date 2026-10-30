"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";

/**
 * Self-service password change.
 *
 * The policy module is imported directly so the hints shown while typing are
 * the same rules the server enforces — a client that disagrees with the server
 * about what is acceptable is worse than no client-side check at all.
 */
export function ChangePasswordForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const problems = next ? checkPassword(next, { name, email }).problems : [];
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length > 0 && problems.length === 0 && !mismatch && !loading;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: current, new_password: next })
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Could not change your password.");
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setDone(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="panel p-6 space-y-4 max-w-md">
      <div>
        <h2 className="text-sm font-medium text-graphite-200">Change your password</h2>
        <p className="text-xs text-graphite-400 mt-1 leading-relaxed">
          At least {MIN_PASSWORD_LENGTH} characters. A short phrase you will remember beats a short scramble you
          will not.
        </p>
      </div>

      {done && (
        <div
          role="status"
          className="text-xs font-mono border border-telemetry-green/40 bg-telemetry-green/10 text-telemetry-green rounded-sm px-3 py-2"
        >
          Password changed. Any other device you were signed in on has been signed out.
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="text-xs font-mono border border-telemetry-red/40 bg-telemetry-red/10 text-telemetry-red rounded-sm px-3 py-2"
        >
          {error}
        </div>
      )}

      <label className="block">
        <span className="data-label block mb-1.5">CURRENT PASSWORD</span>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </label>

      <label className="block">
        <span className="data-label block mb-1.5">NEW PASSWORD</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </label>

      {problems.length > 0 && (
        <ul className="text-[11px] text-telemetry-amber space-y-1 border-l-2 border-telemetry-amber/40 pl-3">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <label className="block">
        <span className="data-label block mb-1.5">CONFIRM NEW PASSWORD</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </label>
      {mismatch && <p className="text-[11px] text-telemetry-amber">The two new passwords do not match.</p>}

      <button type="submit" disabled={!canSubmit} className="btn-primary">
        {loading ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
