import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-graphite-950 text-graphite-100">
      <div className="text-center">
        <div className="font-mono text-signal text-sm">404</div>
        <h1 className="text-2xl font-semibold mt-2">Not found</h1>
        <Link href="/dashboard" className="btn-primary inline-flex mt-4">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
