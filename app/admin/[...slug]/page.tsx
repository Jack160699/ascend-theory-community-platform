import { requireAdmin } from "@/lib/admin/auth";
import { AdminSubRouteView } from "@/components/admin/views/AdminSubRouteView";

export default async function AdminSubRoutePage() {
  // Fail-closed server-side verification of admin session & active admin profile
  await requireAdmin();

  return <AdminSubRouteView />;
}
