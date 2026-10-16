"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield, Lock, ArrowRight, Sparkles, AlertCircle } from "lucide-react";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminLoadingState } from "@/components/admin/ui/AdminLoadingState";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { validateRedirectUrl } from "@/lib/admin/auth-shared";
import { hasSupabaseConfig } from "@/lib/supabase/env";

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Enforce open redirect protection
  const rawFrom = searchParams.get("from");
  const targetRedirect = validateRedirectUrl(rawFrom, "/admin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      if (hasSupabaseConfig()) {
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setErrorMsg(error.message || "Invalid authentication credentials.");
          setLoading(false);
          return;
        }
      } else {
        // Safe dev fallback when Supabase keys are not configured locally
        document.cookie = `ascend_hq_session=dev_authenticated_session; path=/; max-age=${
          60 * 60 * 24
        }; SameSite=Lax`;
      }

      router.push(targetRedirect);
      router.refresh();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Authentication failed.");
      setLoading(false);
    }
  };

  return (
    <AdminCard className="border-white/10 p-6 sm:p-8 bg-zinc-950/90 shadow-2xl">
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300 mb-5">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
            Admin Identity / Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-xl border border-white/10 bg-zinc-900/80 px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            placeholder="admin@ascendtheory.com"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-white/10 bg-zinc-900/80 px-3.5 py-2.5 text-sm text-white focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            placeholder="••••••••••••"
          />
        </div>

        <AdminButton
          type="submit"
          variant="primary"
          size="lg"
          className="w-full mt-2"
          disabled={loading}
          icon={loading ? <Shield className="h-4 w-4 animate-pulse" /> : <ArrowRight className="h-4 w-4" />}
        >
          {loading ? "Authenticating Session..." : "Sign In to Ascend HQ"}
        </AdminButton>
      </form>

      <div className="mt-6 pt-4 border-t border-white/10 text-center space-y-2">
        <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-400">
          <Lock className="h-3.5 w-3.5 text-zinc-500" />
          <span>Server-Validated Supabase SSR Security</span>
        </div>
        <p className="text-[10px] text-zinc-500">
          Ascend Theory Platform Operations &bull; Phase 2 Auth Foundation
        </p>
      </div>
    </AdminCard>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[#050505] px-4 py-12 text-white selection:bg-zinc-800">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(95,115,134,0.08)_0%,transparent_70%)] pointer-events-none" />

      <div className="relative w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-zinc-900 text-white font-black text-xl shadow-2xl mb-2">
            A
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            ASCEND HQ <Sparkles className="h-4 w-4 text-amber-400" />
          </h1>
          <p className="text-xs text-zinc-400 font-mono tracking-widest uppercase">
            Unified Platform Control Center
          </p>
        </div>

        <Suspense fallback={<AdminLoadingState label="Loading Auth Gateway..." />}>
          <LoginFormContent />
        </Suspense>
      </div>
    </div>
  );
}
