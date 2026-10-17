"use client";

import React, { useState } from "react";
import { AdminSubModule, AdminDomainSection } from "@/lib/admin/navigation";
import { AdminPageHeader } from "./AdminPageHeader";
import { AdminCard } from "./AdminCard";
import { AdminBadge } from "./AdminBadge";
import { AdminButton } from "./AdminButton";
import { AdminStatCard } from "./AdminStatCard";
import { AdminTable, Column } from "./AdminTable";
import { AdminEmptyState } from "./AdminEmptyState";
import { Sliders, RefreshCw, ShieldAlert, Layers, ExternalLink, Plus } from "lucide-react";

type AdminModulePlaceholderProps = {
  domain: AdminDomainSection;
  module: AdminSubModule;
};

type GenericRecord = {
  id: string;
  name: string;
  category: string;
  status: string;
  updatedAt: string;
  value: string;
};

export function AdminModulePlaceholder({
  domain,
  module,
}: AdminModulePlaceholderProps) {
  const [activeTab, setActiveTab] = useState<"records" | "config" | "roadmap">("records");
  const [showEmpty, setShowEmpty] = useState(false);

  const sampleRecords: GenericRecord[] = [
    {
      id: `${module.id.toUpperCase()}-001`,
      name: `${module.title} Primary Control Spec`,
      category: domain.title,
      status: "Active",
      updatedAt: "2 mins ago",
      value: "99.4%",
    },
    {
      id: `${module.id.toUpperCase()}-002`,
      name: `${module.title} Secondary Asset Queue`,
      category: domain.title,
      status: "Synced",
      updatedAt: "1 hour ago",
      value: "1,240 units",
    },
    {
      id: `${module.id.toUpperCase()}-003`,
      name: `${module.title} System Telemetry Log`,
      category: domain.title,
      status: "Verified",
      updatedAt: "3 hours ago",
      value: "OK (0 errors)",
    },
    {
      id: `${module.id.toUpperCase()}-004`,
      name: `${module.title} Operational Benchmark`,
      category: domain.title,
      status: "Pending",
      updatedAt: "12 hours ago",
      value: "v1.4.2",
    },
  ];

  const columns: Column<GenericRecord>[] = [
    {
      header: "ID",
      accessorKey: "id",
      className: "font-mono text-zinc-400 font-semibold w-32",
    },
    {
      header: "Record Identifier",
      cell: (item) => (
        <div>
          <div className="font-semibold text-white">{item.name}</div>
          <div className="text-[11px] text-zinc-500">{item.category} Module</div>
        </div>
      ),
    },
    {
      header: "Status",
      cell: (item) => (
        <AdminBadge
          variant={item.status === "Active" || item.status === "Synced" || item.status === "Verified" ? "success" : "warning"}
          size="sm"
        >
          {item.status}
        </AdminBadge>
      ),
    },
    {
      header: "Telemetry Metric",
      accessorKey: "value",
      className: "font-mono text-zinc-300",
    },
    {
      header: "Last Update",
      accessorKey: "updatedAt",
      className: "text-zinc-500 text-xs",
    },
    {
      header: "Action",
      cell: () => (
        <AdminButton variant="outline" size="sm">
          Manage
        </AdminButton>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={module.title}
        description={module.description}
        status={module.status}
        badge={module.badge}
        breadcrumbs={[
          { label: domain.title, href: `/admin/${domain.id}` },
          { label: module.title },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <AdminButton
              variant="outline"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => setShowEmpty(!showEmpty)}
            >
              Toggle Empty View
            </AdminButton>
            <AdminButton
              variant="primary"
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
            >
              New {module.title.slice(0, -1)}
            </AdminButton>
          </div>
        }
      />

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard
          title="Module Status"
          value={module.status.toUpperCase()}
          change="Operational"
          trend="up"
          subtext="Phase 1 Ready"
          icon={<Layers className="h-4 w-4 text-emerald-400" />}
        />
        <AdminStatCard
          title="Domain Context"
          value={domain.title}
          subtext={`${domain.modules.length} Connected Sub-modules`}
          icon={<Sliders className="h-4 w-4 text-zinc-400" />}
        />
        <AdminStatCard
          title="Active Telemetry"
          value="100%"
          change="Optimal"
          trend="up"
          subtext="Response < 15ms"
          icon={<RefreshCw className="h-4 w-4 text-blue-400" />}
        />
        <AdminStatCard
          title="RBAC Guard"
          value={module.minRole ? module.minRole.toUpperCase() : "SUPPORT+"}
          subtext="Boundary Guard Active"
          icon={<ShieldAlert className="h-4 w-4 text-amber-400" />}
        />
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("records")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === "records"
                ? "bg-white/10 text-white border border-white/15"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            Live Records ({showEmpty ? 0 : sampleRecords.length})
          </button>
          <button
            onClick={() => setActiveTab("config")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === "config"
                ? "bg-white/10 text-white border border-white/15"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            Module Configuration
          </button>
          <button
            onClick={() => setActiveTab("roadmap")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === "roadmap"
                ? "bg-white/10 text-white border border-white/15"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            Phase 2 Scope & API Contracts
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "records" && (
        <>
          {showEmpty ? (
            <AdminEmptyState
              title={`No ${module.title} Records Found`}
              description={`There are currently no active data entries for ${module.title}. Click below to configure or sync records for this module.`}
              actionLabel={`Create ${module.title} Entry`}
              onAction={() => setShowEmpty(false)}
              badge="Phase 1 Foundation"
            />
          ) : (
            <AdminTable
              columns={columns}
              data={sampleRecords}
              keyExtractor={(item) => item.id}
            />
          )}
        </>
      )}

      {activeTab === "config" && (
        <AdminCard className="space-y-4">
          <h3 className="text-base font-semibold text-white">
            {module.title} Feature Parameters
          </h3>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Configure system parameters, notification webhooks, and default options for {module.title}.
          </p>

          <div className="space-y-3 pt-2">
            {[
              { name: "Enable Real-time Webhook Telemetry", status: "Enabled", type: "Toggle" },
              { name: "Audit Trail Logging for Member Actions", status: "Active", type: "Security" },
              { name: "Sync Frequency Window", status: "Every 5 Minutes", type: "Schedule" },
              { name: "Fallback Failure Strategy", status: "Graceful Queue", type: "Failover" },
            ].map((setting, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-zinc-900/60 p-3 text-xs"
              >
                <div>
                  <div className="font-semibold text-white">{setting.name}</div>
                  <div className="text-[11px] text-zinc-500">{setting.type} Setting</div>
                </div>
                <span className="font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 text-[11px]">
                  {setting.status}
                </span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {activeTab === "roadmap" && (
        <AdminCard className="space-y-4 border-amber-500/20 bg-amber-950/10">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
            <ExternalLink className="h-4 w-4" /> Phase 2 Deep Integration Scope
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            The foundation for <span className="text-white font-semibold">{module.title}</span> is active in Ascend HQ Phase 1 shell.
            Phase 2 will connect live database models, background queues, and deep API integrations:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-xs text-zinc-400 pl-1">
            <li>Database persistence & CRUD schemas for {module.title} entities.</li>
            <li>Role-based granular action guards (`read`, `write`, `delete`, `approve`).</li>
            <li>Webhooks, courier/partner dispatch routines, and audit stream subscriptions.</li>
          </ul>
        </AdminCard>
      )}
    </div>
  );
}
