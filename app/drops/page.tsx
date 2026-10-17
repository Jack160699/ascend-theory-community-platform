import { CommerceShell } from "@/components/cart/CommerceShell";
import { DropsPage } from "@/components/pages/DropsPage";
import { AssessmentModalProvider } from "@/contexts/assessment-modal";
import { getPublicProducts } from "@/lib/wearables/store";
import { publicProductToDrop } from "@/lib/data/drops";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Drops | Ascend Theory",
  description: "Limited releases. No restock. Enter each drop.",
};

export default async function DropsRoute() {
  const products = await getPublicProducts();
  const drops = products.map(publicProductToDrop);

  return (
    <AssessmentModalProvider>
      <CommerceShell>
        <DropsPage drops={drops} />
      </CommerceShell>
    </AssessmentModalProvider>
  );
}
