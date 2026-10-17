import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/shell/AdminShell";
import { getAdminSession } from "@/lib/admin/auth";

export const metadata: Metadata = {
  title: "Ascend HQ",
  description: "Orders, products, designs and Qikink fulfilment for Ascend Theory.",
  robots: { index: false, follow: false },
};

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const user = await getAdminSession();
  return <AdminShell user={user}>{children}</AdminShell>;
}
