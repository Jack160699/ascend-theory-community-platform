import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { WearablesAdminContainer } from "@/components/admin/wearables/WearablesAdminContainer";

const WEARABLES_TABS = new Set(["products", "collections", "design-studio", "pod-mapping", "fulfillment"]);

export default async function AdminSubRoutePage({ params }: { params: Promise<{ slug: string[] }> }) {
  await requireAdmin();
  const { slug } = await params;

  if (slug[0] === "wearables") {
    if (slug.length === 1) redirect("/admin/wearables/products");
    if (slug.length === 2 && WEARABLES_TABS.has(slug[1]!)) return <WearablesAdminContainer />;
  }
  notFound();
}
