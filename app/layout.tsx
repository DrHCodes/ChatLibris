import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "ChatLibris — Ask the literature",
  description:
    "Academic literature answers with claim-level citations and an honest unknown when the retrieved evidence is insufficient.",
  applicationName: "ChatLibris",
  keywords: [
    "academic literature",
    "research digest",
    "evidence synthesis",
    "scientific papers",
    "AI research assistant",
  ],
  authors: [{ name: "ChatLibris" }],
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "ChatLibris — Evidence, not vibes",
    description:
      "Search academic literature, synthesize the evidence, and abstain when the answer is unknown.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "ChatLibris — Evidence, not vibes",
    description:
      "Academic answers with claim-level citations and honest abstention.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f0e7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
