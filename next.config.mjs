/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles only the production dependencies actually used,
  // into .next/standalone — the deployable artifact is self-contained and
  // doesn't require `npm install` on the host. Verified this still packages
  // better-sqlite3's native binding correctly (see DEPLOYMENT.md).
  output: "standalone",
  // This app never uses next/image, but the endpoint exists in every Next.js
  // server regardless — disabling optimization here plus blocking the path
  // at the reverse proxy (see deploy/Caddyfile, deploy/nginx.conf) removes
  // it as an attack surface in depth, covering the Image Optimization API
  // advisories in `npm audit` that a same-minor-line patch can't reach.
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
    // Required in Next 14.x for instrumentation.ts (env-secret boot check) to
    // actually run — this became default-on in Next 15, but here it must be
    // explicitly enabled or the file is silently ignored.
    instrumentationHook: true
  }
};
export default nextConfig;
