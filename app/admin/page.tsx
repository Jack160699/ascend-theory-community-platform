import { requireAdmin } from "@/lib/admin/auth";
import { getHqMetrics } from "@/lib/admin/metrics";
import { AdminDashboardView } from "@/components/admin/views/AdminDashboardView";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await requireAdmin();
  const metrics = await getHqMetrics();
  return <AdminDashboardView metrics={metrics} />;
}
