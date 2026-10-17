"use client";

import React from "react";
import Link from "next/link";
import {
  TrendingUp,
  Users,
  ShoppingBag,
  BookOpen,
  ArrowUpRight,
  Zap,
  Activity,
  Layers,
  Sparkles,
  ExternalLink,
  Plus,
} from "lucide-react";
import { ADMIN_DOMAINS } from "@/lib/admin/navigation";
import { AdminCard, AdminCardHeader, AdminCardTitle } from "@/components/admin/ui/AdminCard";
import { AdminStatCard } from "@/components/admin/ui/AdminStatCard";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminPageHeader } from "@/components/admin/ui/AdminPageHeader";

export function AdminDashboardView() {
  const recentActivities = [
    { id: "1", title: "Order #AT-9842 confirmed via Razorpay", time: "3 mins ago", tag: "Commerce", status: "success" },
    { id: "2", title: "New member @sovereign_apex registered", time: "14 mins ago", tag: "Community", status: "info" },
    { id: "3", title: "Journal Article 'Architecture of Focus' published", time: "1 hour ago", tag: "Journal", status: "success" },
    { id: "4", title: "POD Abstraction check: Qikink mock payload OK", time: "3 hours ago", tag: "Fulfilment", status: "warning" },
    { id: "5", title: "Drop 01 Inventory sync verified (500 units)", time: "5 hours ago", tag: "Wearables", status: "success" },
  ];

  const integrations = [
    { name: "Razorpay Payments", status: "Connected", ping: "22ms", type: "Gateway" },
    { name: "Stripe Subscriptions", status: "Connected", ping: "45ms", type: "Gateway" },
    { name: "Meta Pixel Analytics", status: "Active", ping: "12ms", type: "Telemetry" },
    { name: "Microsoft Clarity", status: "Active", ping: "18ms", type: "Telemetry" },
    { name: "Qikink POD Engine", status: "Abstraction Ready", ping: "Phase 1", type: "Fulfillment" },
    { name: "Printrove POD Engine", status: "Abstraction Ready", ping: "Phase 1", type: "Fulfillment" },
  ];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <AdminPageHeader
        title="Ascend HQ Dashboard"
        description="Unified platform operations center for Ascend Theory — managing Website, Journal, Community, Membership, Wearables, Commerce, Fulfilment, Marketing, Growth, and System."
        badge="Phase 2 Hardened"
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/wearables/drops">
              <AdminButton variant="outline" size="sm" icon={<Zap className="h-3.5 w-3.5 text-amber-400" />}>
                Drop 01 Live Status
              </AdminButton>
            </Link>
            <Link href="/admin/commerce/orders">
              <AdminButton variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />}>
                View All Orders
              </AdminButton>
            </Link>
          </div>
        }
      />

      {/* Top Stat Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard
          title="Platform Revenue (MTD)"
          value="₹4,28,500"
          change="+18.4%"
          trend="up"
          subtext="vs previous cycle"
          icon={<ShoppingBag className="h-4 w-4 text-emerald-400" />}
        />
        <AdminStatCard
          title="Active Members"
          value="2,480"
          change="+124 this week"
          trend="up"
          subtext="Theory Circle & Inner"
          icon={<Users className="h-4 w-4 text-sky-400" />}
        />
        <AdminStatCard
          title="Wearables Fulfilment Rate"
          value="99.2%"
          change="Optimal"
          trend="up"
          subtext="Average dispatch 1.2 days"
          icon={<TrendingUp className="h-4 w-4 text-amber-400" />}
        />
        <AdminStatCard
          title="Journal Engagement"
          value="14,290"
          change="+34.2%"
          trend="up"
          subtext="Monthly editorial reads"
          icon={<BookOpen className="h-4 w-4 text-purple-400" />}
        />
      </div>

      {/* Platform Domains Directory Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <Layers className="h-5 w-5 text-emerald-400" /> Unified Platform Domains (10 Modules)
            </h2>
            <p className="text-xs text-zinc-400">
              Direct access to all platform operational boundaries in Ascend HQ.
            </p>
          </div>
          <span className="text-xs font-mono text-zinc-500">45+ Active Module Routes</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {ADMIN_DOMAINS.map((domain) => (
            <AdminCard key={domain.id} hoverable className="flex flex-col justify-between p-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-bold">
                    {domain.title}
                  </span>
                  {domain.badge && (
                    <AdminBadge variant="outline" size="sm">
                      {domain.badge}
                    </AdminBadge>
                  )}
                </div>

                <p className="text-[11px] text-zinc-400 line-clamp-2 mb-3">
                  {domain.modules.map((m) => m.title).join(" \u2022 ")}
                </p>
              </div>

              <div className="pt-3 border-t border-white/5 flex items-center justify-between text-xs">
                <span className="text-[11px] text-zinc-500 font-mono">
                  {domain.modules.length} modules
                </span>
                <Link
                  href={domain.modules[0].href}
                  className="font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5"
                >
                  Manage <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            </AdminCard>
          ))}
        </div>
      </div>

      {/* Two Column Layout: Real-Time Stream & Integrations Health */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Real-time Activity Feed (2 cols) */}
        <AdminCard className="lg:col-span-2">
          <AdminCardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
              <AdminCardTitle>Live Ascend Theory Activity Stream</AdminCardTitle>
            </div>
            <Link
              href="/admin/overview/activity"
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 font-medium"
            >
              View Full Stream <ExternalLink className="h-3 w-3" />
            </Link>
          </AdminCardHeader>

          <div className="space-y-3">
            {recentActivities.map((act) => (
              <div
                key={act.id}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-zinc-900/60 p-3.5 text-xs transition-colors hover:border-white/10"
              >
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <div>
                    <div className="font-semibold text-white">{act.title}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">{act.time}</div>
                  </div>
                </div>
                <AdminBadge variant={act.status as "success" | "info" | "warning"} size="sm">
                  {act.tag}
                </AdminBadge>
              </div>
            ))}
          </div>
        </AdminCard>

        {/* Right Column: Platform Gateways & Integrations */}
        <AdminCard>
          <AdminCardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              <AdminCardTitle>Integrations Telemetry</AdminCardTitle>
            </div>
            <Link
              href="/admin/system/integrations"
              className="text-xs text-zinc-400 hover:text-white font-medium"
            >
              Manage
            </Link>
          </AdminCardHeader>

          <div className="space-y-3">
            {integrations.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-zinc-900/60 p-3 text-xs"
              >
                <div>
                  <div className="font-semibold text-zinc-200">{item.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">{item.type}</div>
                </div>
                <div className="text-right">
                  <span className="inline-block rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono font-medium text-emerald-400">
                    {item.status}
                  </span>
                  <div className="text-[10px] font-mono text-zinc-500 mt-0.5">{item.ping}</div>
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      </div>
    </div>
  );
}
