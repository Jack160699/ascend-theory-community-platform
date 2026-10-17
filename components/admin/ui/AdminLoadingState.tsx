import React from "react";

export function AdminLoadingState({ label = "Loading Ascend HQ..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center my-8">
      <div className="relative flex h-10 w-10 items-center justify-center">
        <div className="absolute h-full w-full rounded-full border-2 border-white/10 border-t-zinc-200 animate-spin" />
      </div>
      <p className="mt-4 text-xs font-mono tracking-widest text-zinc-400 uppercase">
        {label}
      </p>
    </div>
  );
}

export function AdminTableSkeleton() {
  return (
    <div className="w-full space-y-3 animate-pulse">
      <div className="h-10 rounded-xl bg-zinc-900/80 border border-white/5" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-14 rounded-xl bg-zinc-900/40 border border-white/5" />
      ))}
    </div>
  );
}
