"use client";

import React, { useState, useEffect } from "react";
import type { ProductReadinessReport } from "@/lib/wearables/design-types";

export function ReadinessQueueView() {
  const [reports, setReports] = useState<ProductReadinessReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReadiness = () => {
    setError(null);
    fetch("/api/admin/wearables/readiness")
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("Failed to load readiness queue");
      })
      .then((data) => {
        if (data?.reports) setReports(data.reports);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load readiness queue");
        setLoading(false);
      });
  };

  useEffect(() => {
    let isMounted = true;
    fetch("/api/admin/wearables/readiness")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data?.reports) setReports(data.reports);
        setLoading(false);
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load readiness queue");
          setLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-sm font-mono text-white/50">Evaluating Fulfilment Readiness Engine...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-zinc-900/60 p-6 rounded-lg border border-white/10 flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded uppercase">
              Operational Gatekeeper
            </span>
            <h2 className="text-xl font-bold tracking-tight text-white">Fulfilment Readiness Queue</h2>
          </div>
          <p className="text-xs text-white/60 mt-1">
            Evaluates design artwork, physical placements, POD provider mappings, and mockup approvals. Prevents unverified products from entering manufacturing dispatch.
          </p>
        </div>

        <button
          type="button"
          onClick={loadReadiness}
          className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white font-mono text-xs rounded border border-white/20 transition"
        >
          Re-evaluate Engine
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-950/80 border border-red-500/40 rounded-md text-red-200 text-xs font-mono">
          🚨 {error}
        </div>
      )}

      {/* Reports Grid */}
      <div className="space-y-4">
        {reports.map((pReport) => (
          <div key={pReport.productId} className="bg-zinc-900/40 border border-white/10 rounded-lg p-5 space-y-3">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-white/10 pb-3">
              <div>
                <span className="text-base font-bold font-mono text-white">{pReport.title}</span>
                <span className="text-xs font-mono text-white/50 block">slug: {pReport.slug}</span>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-white/70">
                  Ready Variants: <strong className="text-white">{pReport.readyVariantCount} / {pReport.totalVariantCount}</strong>
                </span>

                {pReport.overallReady ? (
                  <span className="px-3 py-1 text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded uppercase shadow">
                    ✓ READY FOR FULFILMENT
                  </span>
                ) : pReport.readyVariantCount > 0 ? (
                  <span className="px-3 py-1 text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded uppercase">
                    DESIGN READY / MAPPING INCOMPLETE
                  </span>
                ) : (
                  <span className="px-3 py-1 text-xs font-mono font-bold bg-red-500/20 text-red-300 border border-red-500/40 rounded uppercase">
                    🚫 BLOCKED
                  </span>
                )}
              </div>
            </div>

            {/* Variant Breakdown Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/10 text-white/50 text-[11px] uppercase">
                    <th className="py-2 px-3">Variant / SKU</th>
                    <th className="py-2 px-3">Size / Color</th>
                    <th className="py-2 px-3 text-center">Design & Artwork</th>
                    <th className="py-2 px-3 text-center">Placement</th>
                    <th className="py-2 px-3 text-center">Provider Mapping</th>
                    <th className="py-2 px-3 text-center">Mockups</th>
                    <th className="py-2 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {pReport.variants.map((v) => (
                    <tr key={v.variantId} className="hover:bg-white/5">
                      <td className="py-2.5 px-3 font-bold text-white">{v.sku}</td>
                      <td className="py-2.5 px-3 text-white/70">{v.size} / {v.color}</td>
                      <td className="py-2.5 px-3 text-center">
                        {v.checks.designAssigned && v.checks.artworkPresent ? (
                          <span className="text-emerald-400">✓ Active</span>
                        ) : (
                          <span className="text-red-400">✗ Missing</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {v.checks.placementValid ? (
                          <span className="text-emerald-400">✓ Valid (mm)</span>
                        ) : (
                          <span className="text-amber-400">⚠️ Unset</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {v.checks.providerVariantMapped ? (
                          <span className="text-emerald-400">✓ Mapped</span>
                        ) : (
                          <span className="text-red-400">✗ Unmapped</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {v.checks.mockupReady ? (
                          <span className="text-emerald-400">✓ Approved</span>
                        ) : (
                          <span className="text-amber-400">⚠️ Pending</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold">
                        {v.readyForFulfillment ? (
                          <span className="text-emerald-400">READY</span>
                        ) : (
                          <span className="text-red-400 text-[10px]" title={v.blockingReasons.join(", ")}>
                            {v.blockingReasons[0] || "BLOCKED"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
