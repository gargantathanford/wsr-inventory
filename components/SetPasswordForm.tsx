"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";

export function SetPasswordForm({ token, name, email }: { token: string; name: string; email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const problems = password ? checkPassword(password, { name, email }).problems : [];
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length > 0 && problems.length === 0 && !mismatch && !loading;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Could not set your password.");
      return;
    }
    // Straight to sign-in rather than auto-logging-in: typing the new password
    // once proves it works while they are still paying attention.
    router.push("/login");
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      {error && (
        <div
          role="alert"
          className="text-xs font-mono border border-telemetry-red/40 bg-telemetry-red/10 text-telemetry-red rounded-sm px-3 py-2"
        >
          {error}
        </div>
      )}

      <label className="block">
        <span className="data-label block mb-1.5">CHOOSE A PASSWORD</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <span className="block text-[11px] text-graphite-500 mt-1.5">
          At least {MIN_PASSWORD_LENGTH} characters. A short phrase you will remember beats a short scramble you
          will not.
        </span>
      </label>

      {problems.length > 0 && (
        <ul className="text-[11px] text-telemetry-amber space-y-1 border-l-2 border-telemetry-amber/40 pl-3">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <label className="block">
        <span className="data-label block mb-1.5">CONFIRM PASSWORD</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </label>
      {mismatch && <p className="text-[11px] text-telemetry-amber">The two passwords do not match.</p>}

      <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
        {loading ? "Setting…" : "Set password and continue"}
      </button>
    </form>
  );
}
