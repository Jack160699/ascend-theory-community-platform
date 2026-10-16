"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { FulfillmentRecord } from "@/lib/fulfillment/fulfillment-store";

export function FulfillmentView() {
  const [fulfillments, setFulfillments] = useState<FulfillmentRecord[]>([]);
  const [safetyStatus, setSafetyStatus] = useState<{ transportLocked: boolean; apiContractUnverified: boolean }>({
    transportLocked: true,
    apiContractUnverified: true,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Manual order submission form state
  const [inputOrderId, setInputOrderId] = useState("");

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    async function loadFulfillments() {
      setError(null);
      try {
        const res = await fetch("/api/admin/wearables/fulfillment");
        if (res.ok) {
          const data = (await res.json()) as {
            fulfillments?: FulfillmentRecord[];
            safetyStatus?: { transportLocked: boolean; apiContractUnverified: boolean };
          };
          if (isMounted.current) {
            setFulfillments(data.fulfillments ?? []);
            if (data.safetyStatus) setSafetyStatus(data.safetyStatus);
          }
        } else {
          if (isMounted.current) setError("Failed to load fulfillment queue");
        }
      } catch (err) {
        if (isMounted.current) setError(err instanceof Error ? err.message : "Network error");
      } finally {
        if (isMounted.current) setLoading(false);
      }
    }
    void loadFulfillments();
    return () => {
      isMounted.current = false;
    };
  }, [refreshTick]);

  const fetchFulfillments = useCallback(async () => {
    setRefreshTick((t) => t + 1);
  }, []);

  const handleClaimAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputOrderId.trim()) return;

    setActionLoading("submitting");
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/wearables/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim_and_submit", orderId: inputOrderId.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Fulfillment submission failed");
      } else {
        setSuccess(`Order ${inputOrderId} submitted for fulfillment successfully.`);
        setInputOrderId("");
        await fetchFulfillments();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetry = async (fulfillmentId: string) => {
    setActionLoading(fulfillmentId);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/wearables/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_submission", fulfillmentId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Retry submission failed");
      } else {
        setSuccess(`Fulfillment ${fulfillmentId} retry attempt completed.`);
        await fetchFulfillments();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReconcile = async (fulfillmentId: string) => {
    setActionLoading(fulfillmentId);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/wearables/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile_submission", fulfillmentId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Reconciliation failed");
      } else {
        setSuccess(`Fulfillment ${fulfillmentId} reconciled successfully.`);
        await fetchFulfillments();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-sm font-mono text-white/50">Loading Ascend Fulfillment Subsystem...</div>;
  }

  return (
    <div className="space-y-6 font-mono text-xs text-white">
      {/* Header */}
      <div className="bg-zinc-900/60 p-6 rounded-lg border border-white/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded uppercase">
              Phase 6 Operations
            </span>
            <h2 className="text-xl font-bold tracking-tight text-white font-sans">POD Manufacturing & Fulfilment Subsystem</h2>
          </div>
          <p className="text-xs text-white/60 mt-1">
            Authoritative Ascend POD fulfillment engine. Provider adapters (Qikink), immutable snapshots, atomic claim-before-submit, and status tracking.
          </p>
        </div>

        {/* Server-Driven Safety Status Badges (Requirement #29) */}
        <div className="flex flex-wrap items-center gap-2">
          {safetyStatus.transportLocked && (
            <span className="px-2.5 py-1 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded font-bold uppercase">
              EXTERNAL TRANSPORT LOCKED
            </span>
          )}
          {safetyStatus.apiContractUnverified && (
            <span className="px-2.5 py-1 text-[10px] bg-red-500/20 text-red-300 border border-red-500/30 rounded font-bold uppercase">
              API CONTRACT UNVERIFIED
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-950/80 border border-red-500/40 rounded-md text-red-200">
          🚨 {error}
        </div>
      )}
      {success && (
        <div className="p-4 bg-emerald-950/80 border border-emerald-500/40 rounded-md text-emerald-200">
          ✓ {success}
        </div>
      )}

      {/* Manual Submit Form */}
      <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-6 space-y-4">
        <h3 className="text-sm font-bold font-mono text-white uppercase border-b border-white/10 pb-2">
          Submit Order for POD Manufacturing
        </h3>
        <form onSubmit={handleClaimAndSubmit} className="flex gap-3">
          <input
            type="text"
            required
            value={inputOrderId}
            onChange={(e) => setInputOrderId(e.target.value)}
            className="flex-1 bg-black/60 border border-white/20 rounded p-2 text-xs font-mono text-white"
            placeholder="Enter Ascend Order ID (e.g. ORD-10001)"
          />
          <button
            type="submit"
            disabled={actionLoading === "submitting"}
            className="px-5 py-2 bg-white text-black font-bold font-mono text-xs rounded hover:bg-white/90 transition"
          >
            {actionLoading === "submitting" ? "Submitting..." : "Claim & Submit Order"}
          </button>
        </form>
      </div>

      {/* Fulfillment Queue */}
      <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-6 space-y-4">
        <h3 className="text-sm font-bold font-mono text-white uppercase border-b border-white/10 pb-2 flex justify-between">
          <span>POD Fulfillment Queue ({fulfillments.length})</span>
          <button onClick={fetchFulfillments} className="text-xs text-white/50 hover:text-white">Refresh</button>
        </h3>

        {fulfillments.length === 0 ? (
          <p className="text-xs text-white/40 italic p-4 text-center">No active or historical POD fulfillment records found.</p>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {fulfillments.map((f) => {
              const snap = f.snapshotJson;
              const hasProviderOrderId = Boolean(f.providerOrderId);
              const isReconciliation = f.status === "RECONCILIATION_REQUIRED";
              const isRetryable = (f.status === "QUEUED" || f.status === "FAILED") && f.retryable !== false && !hasProviderOrderId;

              return (
                <div key={f.id} className="p-4 bg-black/40 border border-white/10 rounded-md space-y-3">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-white/5 pb-2">
                    <div>
                      <span className="font-bold text-white uppercase">Order: {f.orderId}</span>
                      <span className="text-white/40 text-[11px] block">Fulfillment ID: {f.id}</span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-0.5 text-[10px] rounded uppercase font-bold ${
                        f.status === "DELIVERED" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" :
                        f.status === "FAILED" || f.status === "CANCELLED" ? "bg-red-500/20 text-red-300 border border-red-500/30" :
                        f.status === "ACTION_REQUIRED" || f.status === "OUT_OF_STOCK" || f.status === "RECONCILIATION_REQUIRED" || f.status === "UNKNOWN_PROVIDER_STATE" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                        "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                      }`}>
                        {f.status}
                      </span>
                      {f.providerOrderId && (
                        <span className="px-2 py-0.5 text-[10px] bg-white/10 text-white rounded font-mono">
                          Provider Order: {f.providerOrderId}
                        </span>
                      )}
                    </div>
                  </div>

                  {snap && (
                    <div className="space-y-2 bg-black/30 p-2.5 rounded text-[11px]">
                      <div className="flex justify-between text-white/50 text-[10px] border-b border-white/5 pb-1">
                        <span>Items ({snap.items?.length || 0})</span>
                        <span>Mode: {snap.paymentMode?.toUpperCase() || (snap.isCod ? "COD" : "ONLINE")}</span>
                      </div>
                      {(snap.items || []).map((item, idx) => (
                        <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 text-white/70">
                          <div>
                            <span className="font-bold text-white">{item.ascendSku}</span> ({item.quantity}x)
                            <span className="block text-[10px] text-white/50">Provider SKU: {item.providerExternalSku}</span>
                          </div>
                          <div>
                            <span className="text-white/40 block">Placements ({item.placements?.length || 0})</span>
                            {(item.placements || []).map((pl, pIdx) => (
                              <span key={pIdx} className="block text-[10px] text-amber-300">
                                {pl.placementLocation.toUpperCase()} ({pl.printMethod.toUpperCase()}): {pl.widthMm}x{pl.heightMm}mm
                              </span>
                            ))}
                          </div>
                          <div>
                            <span className="text-white/40 block">Customer Destination</span>
                            <span className="text-white">{snap.customerShipping?.fullName}</span>
                            <span className="block text-[10px] text-white/50">{snap.customerShipping?.city}, {snap.customerShipping?.state}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {f.failureMessage && (
                    <div className="p-2 bg-red-950/60 border border-red-500/30 rounded text-[11px] text-red-200">
                      <strong>Failure Reason:</strong> {f.failureMessage}
                    </div>
                  )}

                  <div className="flex justify-between items-center text-[10px] text-white/40 pt-1">
                    <span>Attempts: {f.attemptCount} | Provider Reference: {f.providerReference || "N/A"}</span>
                    <div className="flex items-center space-x-2">
                      {/* Requirement #29: Button controls */}
                      {isReconciliation && (
                        <button
                          type="button"
                          disabled={actionLoading === f.id}
                          onClick={() => handleReconcile(f.id)}
                          className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-bold border border-amber-500/40 rounded transition"
                        >
                          {actionLoading === f.id ? "Reconciling..." : "Reconcile Submission"}
                        </button>
                      )}
                      {isRetryable && (
                        <button
                          type="button"
                          disabled={actionLoading === f.id}
                          onClick={() => handleRetry(f.id)}
                          className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white font-bold rounded transition"
                        >
                          {actionLoading === f.id ? "Retrying..." : "Retry Safe Submission"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
