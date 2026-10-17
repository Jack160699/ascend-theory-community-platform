"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { FulfillmentRecord } from "@/lib/fulfillment/fulfillment-store";

export function FulfillmentView() {
  const [fulfillments, setFulfillments] = useState<FulfillmentRecord[]>([]);
  type QikinkConnection = { credentialsSet: boolean; environment: string; sendingEnabled: boolean; autoSubmit: boolean };
  const [safetyStatus, setSafetyStatus] = useState<{ transportLocked: boolean; apiContractUnverified: boolean; qikink?: QikinkConnection }>({
    transportLocked: true,
    apiContractUnverified: false,
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
            safetyStatus?: { transportLocked: boolean; apiContractUnverified: boolean; qikink?: QikinkConnection };
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

  const runQikinkAction = async (action: "test_connection" | "sync_status" | "sweep") => {
    setActionLoading(action);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/wearables/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message || data.error || "Qikink action failed");
      } else if (action === "test_connection") {
        setSuccess(data.message || "Connected to Qikink.");
      } else if (action === "sync_status") {
        const n = Array.isArray(data.synced) ? data.synced.length : 0;
        setSuccess(`Checked ${n} open Qikink order${n === 1 ? "" : "s"} for status, AWB and courier.`);
        await fetchFulfillments();
      } else {
        const sent = data.sweep?.submitted?.length ?? 0;
        setSuccess(`Sent ${sent} waiting order${sent === 1 ? "" : "s"} to Qikink.`);
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
              QIKINK NOT CONNECTED
            </span>
          )}
          {!safetyStatus.transportLocked && (
            <span className="px-2.5 py-1 text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded font-bold uppercase">
              QIKINK LIVE
            </span>
          )}
        </div>
      </div>

      {/* Qikink connection */}
      <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/10 pb-3">
          <h3 className="text-sm font-bold font-mono text-white uppercase">Qikink connection</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runQikinkAction("test_connection")}
              disabled={actionLoading !== null}
              className="px-3 py-1.5 bg-white text-black font-bold rounded hover:bg-white/90 disabled:opacity-50"
            >
              {actionLoading === "test_connection" ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              onClick={() => runQikinkAction("sync_status")}
              disabled={actionLoading !== null}
              className="px-3 py-1.5 border border-white/20 rounded hover:border-white/50 disabled:opacity-50"
            >
              {actionLoading === "sync_status" ? "Refreshing…" : "Refresh order status"}
            </button>
            <button
              type="button"
              onClick={() => runQikinkAction("sweep")}
              disabled={actionLoading !== null || safetyStatus.transportLocked}
              className="px-3 py-1.5 border border-white/20 rounded hover:border-white/50 disabled:opacity-50"
            >
              {actionLoading === "sweep" ? "Sending…" : "Send waiting orders"}
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Credentials", safetyStatus.qikink?.credentialsSet ? "Set" : "Missing"],
            ["Environment", safetyStatus.qikink?.environment === "live" ? "Live" : "Sandbox"],
            ["Sending", safetyStatus.qikink?.sendingEnabled ? "On" : "Off"],
            ["Auto-send paid orders", safetyStatus.qikink?.autoSubmit ? "On" : "Off"],
          ].map(([label, value]) => (
            <div key={label} className="bg-black/40 border border-white/10 rounded p-3">
              <dt className="text-[10px] uppercase text-white/50">{label}</dt>
              <dd className={`mt-1 font-bold ${value === "Missing" || value === "Off" ? "text-amber-300" : "text-emerald-300"}`}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-white/50 leading-relaxed">
          Paid orders and approved cash-on-delivery orders go to Qikink with each item&apos;s artwork, mockup and print position.
          {safetyStatus.qikink?.environment === "live"
            ? " In live mode this happens automatically."
            : " In sandbox mode nothing is sent automatically, so real orders never land in the test account — send test orders from the queue below, then switch to live credentials."}{" "}
          Only variants with a verified Qikink SKU (POD Mapping) can be sent. Qikink has no status push, so status, AWB and courier are
          refreshed daily and whenever you press Refresh.
        </p>
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
