import { BRAND_ROUTES } from "@/lib/brand/routes";
import { redirect } from "next/navigation";

export default function CollabIndexPage() {
  redirect(BRAND_ROUTES.collab);
}
