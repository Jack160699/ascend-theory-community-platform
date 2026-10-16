import { Metadata } from "next";
import { CodHqView } from "@/components/admin/commerce/CodHqView";

export const metadata: Metadata = {
  title: "COD Risk HQ — Ascend Theory Admin",
  description: "Manage Cash on Delivery risk decisions, OTP verification queues, advance payments, and returned inventory.",
};

export default function AdminCodHqPage() {
  return <CodHqView />;
}
