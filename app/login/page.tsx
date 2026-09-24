"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

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
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-5">
      <div className="hidden lg:flex lg:col-span-3 bg-graphite-900 border-r border-graphite-700/60 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{
          backgroundImage: "repeating-linear-gradient(90deg, #fff 0, #fff 1px, transparent 1px, transparent 64px), repeating-linear-gradient(0deg, #fff 0, #fff 1px, transparent 1px, transparent 64px)"
        }} />
        <div className="relative">
          <div className="flex items-center gap-2 text-signal font-mono text-sm tracking-wide">
            <span className="h-2 w-2 rounded-full bg-signal animate-pulse" />
            WARP SPEED RACING
          </div>
          <h1 className="mt-8 text-5xl font-semibold leading-tight text-graphite-100 max-w-lg">
            Powertrain inventory &amp; shopping list, tracked to the fastener.
          </h1>
          <p className="mt-6 text-graphite-400 max-w-md text-sm leading-relaxed">
            Parts, tools, documentation, and shopping-list risk for the FSAE Michigan build — in one
            system, updated by the people building the car.
          </p>
        </div>
        <div className="relative grid grid-cols-3 gap-6 font-mono text-xs text-graphite-500 border-t border-graphite-700 pt-6">
          <div>
            <div className="text-graphite-200 text-xl">OSU</div>
            CEAT / SGA
          </div>
          <div>
            <div className="text-graphite-200 text-xl">IC</div>
            Class Entry
          </div>
          <div>
            <div className="text-graphite-200 text-xl">SPR 27</div>
            Michigan Target
          </div>
        </div>
      </div>

      <div className="lg:col-span-2 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 font-mono text-signal text-sm tracking-wide">WARP SPEED RACING</div>
          <h2 className="text-xl font-semibold text-graphite-100">Sign in</h2>
          <p className="text-sm text-graphite-400 mt-1">Access the inventory &amp; shopping list system.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="data-label block mb-1.5">EMAIL</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="data-label block mb-1.5">PASSWORD</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div className="text-sm text-telemetry-red font-mono border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
