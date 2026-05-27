"use client";

import { useAuth } from "@/lib/auth";

export function SignInScreen() {
  const { signIn, error } = useAuth();

  return (
    <div className="dot-grid flex min-h-screen items-center justify-center px-6">
      {/* Top corner registration mark */}
      <span className="pointer-events-none fixed left-6 top-6 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-4)]">
        ryze · qa · instrument
      </span>
      <span className="pointer-events-none fixed right-6 top-6 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-4)]">
        v0.1 · {new Date().getFullYear()}
      </span>

      <div className="w-full max-w-md rise-in">
        {/* Outer label */}
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-3)]">
            authentication required
          </span>
          <span className="diode diode--amber diode--pulse" />
        </div>

        <div className="bracket-frame relative border border-[var(--color-rule)] bg-[var(--color-base-1)] p-10">
          <h1 className="font-display text-[56px] leading-[0.95] italic text-[var(--color-ink-1)]">
            Step inside <br />
            the <span className="text-[var(--color-amber)]">instrument.</span>
          </h1>

          <p className="mt-6 max-w-sm font-mono text-[11.5px] leading-[1.7] tracking-wide text-[var(--color-ink-2)]">
            Sign in with your <span className="text-[var(--color-ink-1)]">@ryzewith.com</span> account
            to view scans, stream live telemetry, and arm new audits.
          </p>

          <button
            onClick={signIn}
            className="group mt-10 flex w-full items-center justify-between border border-[var(--color-rule-strong)] bg-[var(--color-base-0)] px-5 py-4 transition hover:border-[var(--color-amber)] hover:bg-[var(--color-base-2)]"
          >
            <span className="flex items-center gap-3">
              <GoogleIcon className="size-4" />
              <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-ink-1)]">
                Authenticate · Google
              </span>
            </span>
            <span className="font-mono text-[var(--color-ink-3)] transition group-hover:translate-x-1 group-hover:text-[var(--color-amber)]">
              ▸
            </span>
          </button>

          {error && (
            <div className="mt-5 border border-[var(--color-coral)]/30 bg-[var(--color-coral)]/5 px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--color-coral)]">
              <span className="mr-2 text-[var(--color-coral)]/70">ERR ▸</span>
              {error}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          <span>session · cold start</span>
          <span className="flex items-center gap-2">
            <span className="diode diode--teal" />
            link · stable
          </span>
        </div>
      </div>

      {/* Bottom corner registration mark */}
      <span className="pointer-events-none fixed bottom-6 left-6 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-4)]">
        restricted · workspace only
      </span>
      <span className="pointer-events-none fixed bottom-6 right-6 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ink-4)]">
        live-qa-agent
      </span>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/>
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84Z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"/>
    </svg>
  );
}
