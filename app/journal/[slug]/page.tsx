import { JournalArticleJsonLd } from "@/components/journal/JournalArticleJsonLd";
import { JournalArticlePage } from "@/components/pages/JournalArticlePage";
import { AssessmentModalProvider } from "@/contexts/assessment-modal";
import {
  getAllJournalSlugs,
  getJournalBySlug,
  getJournalIssueByArticleSlug,
} from "@/lib/data/journal";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ slug: string }>;
};

function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://www.ascendtheory.in"
  );
}

function absoluteUrl(path: string): string {
  const base = siteOrigin();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export function generateStaticParams() {
  return getAllJournalSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getJournalBySlug(slug);
  if (!article) {
    return { title: "Journal | Ascend Theory" };
  }
  const issue = getJournalIssueByArticleSlug(slug);
  const title = issue
    ? `Issue ${issue.number} — ${issue.title} | Ascend Theory Journal`
    : `${article.title} | Ascend Theory Journal`;
  const canonicalPath = `/journal/${slug}`;
  const url = absoluteUrl(canonicalPath);
  const ogImage = article.image.startsWith("http")
    ? article.image
    : absoluteUrl(article.image);

  return {
    title,
    description: article.excerpt,
    alternates: { canonical: canonicalPath },
    openGraph: {
      type: "article",
      url,
      siteName: "Ascend Theory",
      title,
      description: article.excerpt,
      publishedTime: article.publishedISO,
      images: [{ url: ogImage, alt: article.imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: article.excerpt,
      images: [ogImage],
    },
  };
}

export default async function JournalArticleRoute({ params }: PageProps) {
  const { slug } = await params;
  const article = getJournalBySlug(slug);
  if (!article) notFound();

  const issue = getJournalIssueByArticleSlug(slug);
  if (!issue) notFound();

  return (
    <>
      <JournalArticleJsonLd
        article={article}
        issue={issue}
        canonicalPath={`/journal/${slug}`}
      />
      <AssessmentModalProvider>
        <JournalArticlePage article={article} />
      </AssessmentModalProvider>
    </>
  );
}
