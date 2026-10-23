import { CommerceShell } from "@/components/cart/CommerceShell";
import { DropExperience } from "@/components/drop";
import { PrintProductExperience } from "@/components/drop/PrintProductExperience";
import { StudioProductExperience } from "@/components/drop/StudioProductExperience";
import { AssessmentModalProvider } from "@/contexts/assessment-modal";
import { getDropBySlugAsync, getAllDropSlugsAsync } from "@/lib/data/drops";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  const slugs = await getAllDropSlugsAsync();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getDropBySlugAsync(slug);
  if (!product) {
    return { title: "Drop Not Found | Ascend Theory" };
  }
  const image = product.print?.wide.src ?? product.hero.image;
  return {
    title: `${product.name} — ${product.dropName} | Ascend Theory`,
    description: product.print
      ? `${product.name}, ${product.price.display}. ${product.print.collab}. ${product.description}`
      : product.description,
    openGraph: {
      title: `${product.name} — ${product.price.display}`,
      description: product.description,
      images: [{ url: image, alt: product.print?.wide.alt ?? product.hero.alt }],
    },
  };
}

export default async function DropProductPage({ params }: PageProps) {
  const { slug } = await params;
  const product = await getDropBySlugAsync(slug);
  if (!product) notFound();

  return (
    <AssessmentModalProvider>
      <CommerceShell>
        {product.print ? (
          <PrintProductExperience product={product} />
        ) : product.studio ? (
          <StudioProductExperience product={product} />
        ) : (
          <DropExperience product={product} />
        )}
      </CommerceShell>
    </AssessmentModalProvider>
  );
}
