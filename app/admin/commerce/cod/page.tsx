import { Metadata } from "next";
import { CodHqView } from "@/components/admin/commerce/CodHqView";

export const metadata: Metadata = {
  title: "Cash on delivery — Ascend HQ",
  description: "Manage Cash on Delivery risk decisions, OTP verification queues, advance payments, and returned inventory.",
};

export default function AdminCodHqPage() {
  return <CodHqView />;
}
