"use client";

import React, { useState } from "react";
import { Shield, ChevronDown, Check } from "lucide-react";
import { AdminRole, ADMIN_ROLE_DETAILS } from "@/lib/admin/auth-shared";
import { useAdminAuth } from "../shell/AdminAuthContext";

export function AdminRoleBadge() {
  const { user, setRole } = useAdminAuth();
  const [isOpen, setIsOpen] = useState(false);
  const isDev = process.env.NODE_ENV === "development";

  if (!user) return null;

  const roles: AdminRole[] = ["owner", "admin", "editor", "support"];
  const details = ADMIN_ROLE_DETAILS[user.role];

  if (!isDev) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900/90 px-2.5 py-1 text-xs">
        <Shield className="h-3.5 w-3.5 text-zinc-400" />
        <span className={`font-semibold tracking-wide ${details.badgeColor.split(" ")[1]}`}>
          {details.label}
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900/90 px-2.5 py-1 text-xs transition-colors hover:border-white/20 hover:bg-zinc-850 focus:outline-none"
        title="Switch test role (Dev Mode Only)"
      >
        <Shield className="h-3.5 w-3.5 text-zinc-400" />
        <span className={`font-semibold tracking-wide ${details.badgeColor.split(" ")[1]}`}>
          {details.label}
        </span>
        <ChevronDown className="h-3 w-3 text-zinc-500" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 z-50 w-64 rounded-xl border border-white/10 bg-zinc-950 p-2 shadow-2xl backdrop-blur-xl">
            <div className="px-2 py-1.5 border-b border-white/5 mb-1">
              <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                Dev RBAC Tester
              </p>
              <p className="text-xs text-zinc-300 font-medium">Switch Active Role</p>
            </div>
            <div className="space-y-1">
              {roles.map((r) => {
                const roleInfo = ADMIN_ROLE_DETAILS[r];
                const isSelected = user.role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRole(r);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-start gap-2.5 rounded-lg p-2 text-left text-xs transition-colors ${
                      isSelected
                        ? "bg-white/10 text-white"
                        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isSelected ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <div className="h-3.5 w-3.5 rounded-full border border-zinc-700" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold">{roleInfo.label}</div>
                      <div className="text-[11px] text-zinc-500 leading-tight">
                        {roleInfo.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
