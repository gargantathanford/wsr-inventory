import Image from "next/image";
import Link from "next/link";
import { checkSetupToken } from "@/lib/setupTokens";
import { SetPasswordForm } from "@/components/SetPasswordForm";

export const dynamic = "force-dynamic";

/**
 * Set-your-password page, reached from a one-time link.
 *
 * Unauthenticated — the token is the authentication. The token is validated
 * server-side before anything renders, so an expired or spent link shows what
 * actually happened instead of a form that fails on submit.
 */
export default function SetupPage({ params }: { params: { token: string } }) {
  const check = checkSetupToken(params.token);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-graphite-950">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <Image src="/wsr-logo.png" alt="Warp Speed Racing" width={520} height={492} priority className="w-20 h-auto" />
          <div
            aria-hidden="true"
            className="mt-5 h-px w-24"
            style={{ background: "linear-gradient(90deg, #3CD7C5, #FF9900)" }}
          />
        </div>

        {check.valid ? (
          <>
            <div className="mt-8 text-center">
              <h1 className="text-xl font-semibold text-graphite-100">Welcome, {check.name.split(" ")[0]}</h1>
              <p className="text-xs text-graphite-400 mt-2 leading-relaxed">
                Choose a password for <span className="font-mono text-graphite-300">{check.email}</span>. Nobody
                else will know it — not even an admin.
              </p>
            </div>
            <SetPasswordForm token={params.token} name={check.name} email={check.email} />
          </>
        ) : (
          <div className="mt-8 text-center space-y-4">
            <h1 className="text-xl font-semibold text-graphite-100">
              {check.reason === "used"
                ? "This link has already been used"
                : check.reason === "expired"
                ? "This link has expired"
                : "This link is not valid"}
            </h1>
            <p className="text-xs text-graphite-400 leading-relaxed">
              {check.reason === "used"
                ? "Setup links work once. If you have already set your password, sign in below."
                : check.reason === "expired"
                ? "Setup links last 72 hours. Ask a team admin to send you a new one."
                : "Check that you copied the whole link, including the long code at the end."}
            </p>
            <Link href="/login" className="btn-ghost inline-flex text-xs">
              Go to sign in
            </Link>
          </div>
        )}

        <p className="mt-8 text-center font-mono text-[10px] tracking-[0.14em] text-graphite-500">
          OSU-TULSA / FORMULA SAE
        </p>
      </div>
    </div>
  );
}
