import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", base).toString();

  return {
    metadataBase: base,
    title: "Assault Map Maker — Real terrain, game-ready boards",
    description:
      "Turn any real-world 6.93 × 5.25 km area into an Assault terrain board using elevation and OpenStreetMap data.",
    openGraph: {
      title: "Assault Map Maker",
      description: "Real terrain. Game-ready boards.",
      type: "website",
      url: base,
      images: [
        {
          url: socialImage,
          width: 1672,
          height: 941,
          alt: "Assault Map Maker terrain board preview",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Assault Map Maker",
      description: "Real terrain. Game-ready boards.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
