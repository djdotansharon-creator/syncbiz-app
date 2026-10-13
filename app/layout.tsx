import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "flag-icons/css/flag-icons.min.css";
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
  title: "VONO",
  description:
    "Controller and scheduler for business playback. Sends commands to customer-owned endpoint devices. VONO does not store or host media.",
  // PWA: installable + registers as a Web Share Target (see public/manifest.webmanifest).
  manifest: "/manifest.webmanifest",
  applicationName: "VONO",
  appleWebApp: {
    capable: true,
    title: "VONO",
    statusBarStyle: "black-translucent",
  },
  // VONO (owner 2026-10-13): favicon.ico (16/32/48) comes from app/favicon.ico; a crisp PNG for high-DPI tabs / shortcuts
  icons: {
    icon: [{ url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" }],
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
  // Layout is always LTR — only the text localizes (owner directive). No RTL flip.
  const dir = "ltr";
  const lang = locale;

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
