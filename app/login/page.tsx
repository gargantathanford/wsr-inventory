"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

/**
 * Sign-in.
 *
 * Deliberately one centred column rather than the old split hero. This screen
 * has exactly one job and nobody reads marketing copy on the way to typing a
 * password — so it is the mark, the name, and two fields.
 *
 * The brand gradient appears twice and quietly: once as the rule under the
 * wordmark, once as a soft glow behind the logo. Both run turquoise to orange,
 * the same direction as the mark itself.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Login failed.");
      return;
    }
    router.push(params.get("next") || "/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-graphite-950">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            {/* Soft brand glow. Sits behind the mark, never over it. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10 blur-3xl opacity-25"
              style={{ background: "radial-gradient(circle at 50% 55%, #3CD7C5 0%, #FF9900 55%, transparent 72%)" }}
            />
            <Image
              src="/wsr-logo.png"
              alt="Warp Speed Racing"
              width={520}
              height={492}
              priority
              className="w-24 h-auto"
            />
          </div>

          <h1 className="mt-7 text-2xl font-semibold tracking-tight text-graphite-100">Warp Speed Racing</h1>

          {/* Turquoise to orange, matching the mark's own gradient direction. */}
          <div
            aria-hidden="true"
            className="mt-4 h-px w-28"
            style={{ background: "linear-gradient(90deg, #3CD7C5, #FF9900)" }}
          />

          <p className="mt-4 font-mono text-[11px] tracking-[0.18em] text-graphite-400">BUILD DASHBOARD</p>
        </div>

        <form onSubmit={onSubmit} className="mt-10 space-y-4">
          <div>
            <label htmlFor="email" className="data-label block mb-1.5">
              EMAIL
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="data-label block mb-1.5">
              PASSWORD
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div
              role="alert"
              className="text-sm text-telemetry-red font-mono border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2"
            >
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-8 text-center font-mono text-[10px] tracking-[0.14em] text-graphite-500">
          OSU-TULSA / FORMULA SAE
        </p>
      </div>
    </div>
  );
}
