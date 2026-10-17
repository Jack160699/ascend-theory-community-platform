"use client";

import React, { useState, useEffect } from "react";
import type { Order } from "@/lib/orders/types";
import type { ReturnedInventoryItem } from "@/lib/cod/types";

export function CodHqView() {
  const [data, setData] = useState<{
    ok: boolean;
    codOrders: Order[];
    dailyExposurePaise: number;
    returnedInventory: ReturnedInventoryItem[];
    userRole: string;
    error?: string;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/commerce/cod");
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        setData({ ok: false, codOrders: [], dailyExposurePaise: 0, returnedInventory: [], userRole: "", error: json.error });
      }
    } catch (err) {
      setData({ ok: false, codOrders: [], dailyExposurePaise: 0, returnedInventory: [], userRole: "", error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    fetch("/api/admin/commerce/cod")
      .then((res) => res.json())
      .then((json) => {
        if (mounted) {
          if (json.ok) {
            setData(json);
          } else {
            setData({ ok: false, codOrders: [], dailyExposurePaise: 0, returnedInventory: [], userRole: "", error: json.error });
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setData({ ok: false, codOrders: [], dailyExposurePaise: 0, returnedInventory: [], userRole: "", error: String(err) });
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleAction = async (action: string, orderId: string, extraBody: Record<string, unknown> = {}) => {
    const reason = prompt("Enter mandatory decision reason:") || "Manual admin action";
    try {
      const res = await fetch("/api/admin/commerce/cod", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, orderId, reason, ...extraBody }),
      });
      const json = await res.json();
      if (res.ok) {
        setActionMessage(`Action ${action} succeeded for order ${orderId}`);
        fetchData();
      } else {
        alert(`Error: ${json.error}`);
      }
    } catch (err) {
      alert(`Network error: ${String(err)}`);
    }
  };

  if (loading) {
    return <div className="p-8 text-neutral-400">Loading COD Risk HQ...</div>;
  }

  if (data && !data.ok) {
    return (
      <div className="p-8 bg-red-950/20 border border-red-800 text-red-400 rounded-lg">
        <h2 className="text-xl font-bold mb-2">Access Control Violation / Error</h2>
        <p>{data.error || "Forbidden: Operational role permissions insufficient"}</p>
      </div>
    );
  }

  const codOrders = data?.codOrders || [];
  const dailyExposurePaise = data?.dailyExposurePaise || 0;
  const returnedInventory = data?.returnedInventory || [];
  const userRole = data?.userRole || "support";
  const canMutate = ["owner", "admin"].includes(userRole);

  return (
    <div className="space-y-8 p-6">
      <div className="flex justify-between items-center border-b border-neutral-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">COD Risk HQ & Returned Inventory</h1>
          <p className="text-sm text-neutral-400">
            Operational COD risk decisions, daily exposure caps (Asia/Kolkata), and returned inventory reuse.
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs uppercase text-neutral-500 font-mono">Current Active Exposure (Today)</span>
          <div className="text-xl font-mono font-semibold text-emerald-400">
            ₹{(dailyExposurePaise / 100).toLocaleString("en-IN")} / ₹50,000 Cap
          </div>
        </div>
      </div>

      {actionMessage && (
        <div className="p-4 bg-emerald-950/30 border border-emerald-800 text-emerald-300 text-sm rounded">
          {actionMessage}
        </div>
      )}

      {/* COD Orders Table */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Active COD Orders</h2>
        {codOrders.length === 0 ? (
          <p className="text-sm text-neutral-500">No active COD orders recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-neutral-300">
              <thead className="bg-neutral-950 text-xs text-neutral-400 uppercase font-mono border-b border-neutral-800">
                <tr>
                  <th className="p-3">Order ID</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Risk Band/Score</th>
                  <th className="p-3">OTP State</th>
                  <th className="p-3">RTO/Refusals</th>
                  <th className="p-3">COD Status</th>
                  <th className="p-3">Recommended Action</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800 font-mono">
                {codOrders.map((ord: Order & { riskBand?: string; riskScore?: number; otpStatus?: string; otpAttempts?: number; otpMaxAttempts?: number; rtoCount?: number; refusedCount?: number; successfulCodDeliveries?: number; recommendedAction?: string }) => (
                  <tr key={ord.id} className="hover:bg-neutral-800/40">
                    <td className="p-3 font-bold text-white">{ord.id}</td>
                    <td className="p-3 text-neutral-300 font-sans">
                      <div>{ord.customer?.fullName}</div>
                      <div className="text-xs text-neutral-500 font-mono">{ord.customer?.phone}</div>
                    </td>
                    <td className="p-3">
                      <span className="text-xs font-semibold text-amber-400">{ord.riskBand || "NEW_CUSTOMER"}</span>
                      <div className="text-xs text-neutral-500 font-mono">Score: {ord.riskScore ?? 30}</div>
                    </td>
                    <td className="p-3 text-xs">
                      <div>Status: {ord.otpStatus || "none"}</div>
                      <div className="text-neutral-500">Attempts: {ord.otpAttempts ?? 0}/{ord.otpMaxAttempts ?? 5}</div>
                    </td>
                    <td className="p-3 text-xs text-neutral-400">
                      <div>RTO: {ord.rtoCount ?? 0} | Refused: {ord.refusedCount ?? 0}</div>
                      <div className="text-emerald-400">Succ: {ord.successfulCodDeliveries ?? 0}</div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${
                          ord.codStatus === "COD_APPROVED"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : ord.codStatus === "COD_ADVANCE_REQUIRED"
                            ? "bg-amber-950 text-amber-300 border border-amber-800"
                            : ord.codStatus === "COD_HELD"
                            ? "bg-red-950 text-red-300 border border-red-800"
                            : "bg-neutral-800 text-neutral-300"
                        }`}
                      >
                        {ord.codStatus || "COD_PENDING_CONFIRMATION"}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-emerald-400 font-medium">{ord.recommendedAction || "Review status"}</td>
                    <td className="p-3 text-right space-x-2">
                      {canMutate ? (
                        <>
                          <button
                            onClick={() => handleAction("approve_cod", ord.id)}
                            className="px-2 py-1 bg-emerald-900 hover:bg-emerald-800 text-emerald-200 text-xs rounded"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleAction("hold_cod", ord.id)}
                            className="px-2 py-1 bg-amber-900 hover:bg-amber-800 text-amber-200 text-xs rounded"
                          >
                            Hold
                          </button>
                          <button
                            onClick={() => handleAction("reject_cod", ord.id)}
                            className="px-2 py-1 bg-red-900 hover:bg-red-800 text-red-200 text-xs rounded"
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-neutral-500 italic">Read-only (Support)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Returned Inventory Table */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Returned Inventory Candidates</h2>
        {returnedInventory.length === 0 ? (
          <p className="text-sm text-neutral-500">No returned inventory items in queue.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-neutral-300">
              <thead className="bg-neutral-950 text-xs text-neutral-400 uppercase font-mono border-b border-neutral-800">
                <tr>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Condition</th>
                  <th className="p-3">Ageing</th>
                  <th className="p-3">Manufacturing Identity Hash</th>
                  <th className="p-3">Reuse Status</th>
                  <th className="p-3">Replacement Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800 font-mono text-xs">
                {returnedInventory.map((item) => (
                  <tr key={item.id}>
                    <td className="p-3 font-bold text-white">{item.sku}</td>
                    <td className="p-3">{item.condition}</td>
                    <td className="p-3">{item.ageDays} days</td>
                    <td className="p-3 text-neutral-500 font-mono truncate max-w-[150px]">{item.manufacturingIdentityHash}</td>
                    <td className="p-3">{item.reuseStatus}</td>
                    <td className="p-3 text-neutral-400">{item.replacementOrderId || "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
