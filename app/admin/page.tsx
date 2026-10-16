import { requireAdmin } from "@/lib/admin/auth";
import { AdminDashboardView } from "@/components/admin/views/AdminDashboardView";

export default async function AdminDashboardPage() {
  // Fail-closed server-side verification of admin session & active admin profile
  await requireAdmin();

  return <AdminDashboardView />;
}
