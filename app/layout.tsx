import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AscendFilmGrain } from "@/components/AscendFilmGrain";
import { MetaPixel } from "@/components/analytics/MetaPixel";
import { CookieNotice } from "@/components/CookieNotice";
import {
  clarityBootstrapScript,
  shouldLoadMicrosoftClarity,
} from "@/lib/clarity";
import { Footer } from "@/sections/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ascendtheory.in"),
  title: "Ascend Theory — Luxury In Motion",
  description:
    "A futuristic luxury lifestyle and philosophy brand — discipline, ambition, modern performance, and cinematic identity.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-black text-white">
        {/* Meta Pixel: single global injection + route-bound PageViews (production or DEBUG). */}
        <MetaPixel />
        {/* Microsoft Clarity: production only — see lib/clarity.ts */}
        {shouldLoadMicrosoftClarity() ? (
          <Script
            id="microsoft-clarity"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{ __html: clarityBootstrapScript() }}
          />
        ) : null}
        <div className="flex min-h-full flex-1 flex-col">{children}</div>
        <Footer />
        <CookieNotice />
        <AscendFilmGrain />
      </body>
    </html>
  );
}
