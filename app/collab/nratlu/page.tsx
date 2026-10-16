import { CollabDropPage } from "@/components/pages/CollabDropPage";
import { AssessmentModalProvider } from "@/contexts/assessment-modal";
import { NRATLU_COLLAB } from "@/lib/data/collabs";
import type { Metadata } from "next";

const collab = NRATLU_COLLAB;
const description = `${collab.headline} ${collab.statement.join(" ")} Follow ${collab.house.handle} and ${collab.partner.handle}.`;

export const metadata: Metadata = {
  title: `${collab.title} — ${collab.dropName} | Ascend Theory`,
  description,
  openGraph: {
    title: `${collab.title} — ${collab.dropName}`,
    description,
    url: "https://www.ascendtheory.in/collab/nratlu",
    siteName: "Ascend Theory",
    type: "website",
    images: collab.prints.map((p) => ({ url: p.image, alt: p.alt })),
  },
  twitter: {
    card: "summary_large_image",
    title: `${collab.title} — ${collab.dropName}`,
    description,
    images: [collab.prints[1]!.image],
  },
};

export default function NratluCollabRoute() {
  return (
    <AssessmentModalProvider>
      <CollabDropPage collab={collab} />
    </AssessmentModalProvider>
  );
}
