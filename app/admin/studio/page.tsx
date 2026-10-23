import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { StudioFlow } from "@/components/admin/studio/StudioFlow";

export const metadata = { title: "New product — Ascend HQ" };

export default async function StudioPage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-400">Photo or artwork in, product on your store out — with the Qikink print file made for you.</p>
        <Link href="/admin/studio/garments" className="text-xs text-zinc-400 underline-offset-4 hover:text-white hover:underline">
          Qikink garments &amp; SKU codes
        </Link>
      </div>
      <StudioFlow />
    </div>
  );
}
