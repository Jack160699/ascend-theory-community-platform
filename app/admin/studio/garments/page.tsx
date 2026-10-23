import { requireAdmin } from "@/lib/admin/auth";
import { GarmentSettings } from "@/components/admin/studio/GarmentSettings";

export const metadata = { title: "Qikink garments — Ascend HQ" };

export default async function GarmentsPage() {
  await requireAdmin();
  return <GarmentSettings />;
}
