import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/lib/locale-server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SyncBiz – Media Control & Scheduling",
  description:
    "Controller and scheduler for business playback. Sends commands to customer-owned endpoint devices. SyncBiz does not store or host media.",
  // PWA: installable + registers as a Web Share Target (see public/manifest.webmanifest).
  manifest: "/manifest.webmanifest",
  applicationName: "SyncBiz",
  appleWebApp: {
    capable: true,
    title: "SyncBiz",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0f16",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const dir = locale === "he" ? "rtl" : "ltr";
  const lang = locale === "he" ? "he" : "en";

  return (
    <html lang={lang} dir={dir}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-950 text-slate-50`}
      >
        {children}
      </body>
    </html>
  );
}
