import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/shell/AdminShell";

export const metadata: Metadata = {
  title: "Ascend HQ — Unified Platform Control Center",
  description:
    "Ascend Theory Unified Admin and Platform Management HQ — Website, Journal, Community, Membership, Wearables, Commerce, Fulfilment, Marketing, Growth & System.",
};

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
