"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { getModuleByPath } from "@/lib/admin/navigation";
import { AdminModulePlaceholder } from "@/components/admin/ui/AdminModulePlaceholder";
import { AdminEmptyState } from "@/components/admin/ui/AdminEmptyState";

import { WearablesAdminContainer } from "@/components/admin/wearables/WearablesAdminContainer";

export function AdminSubRouteView() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin/wearables")) {
    return <WearablesAdminContainer />;
  }

  const { domain, module } = getModuleByPath(pathname);

  if (!domain || !module) {
    return (
      <AdminEmptyState
        title="Module Route Not Found"
        description="The requested Ascend HQ route is not currently registered in the platform navigation registry."
        badge="404 HQ"
      />
    );
  }

  return <AdminModulePlaceholder domain={domain} module={module} />;
}
