import { LOCALES } from "@/lib/locales";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Heebo, Rubik } from "next/font/google";
import "./globals.css";
import "./lite-fx.css";
import "./white-look.css";
import "./kiosk-display.css";
import "flag-icons/css/flag-icons.min.css";
import { getLocale } from "@/lib/locale-server";
import { FIRST_PAINT_BOOT_SCRIPT, FX_BOOT_SCRIPT, KIOSK_BOOT_SCRIPT } from "@/lib/fx-boot";
import { NoNativeTooltips } from "@/components/no-native-tooltips";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Hebrew UI face (owner 2026-10-20: "not a good font in Hebrew"): Arial's Hebrew is narrow and heavy; Heebo is clean and even. Used in the player's side panel in Hebrew (see `(rtl)` block, globals.css).
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// The display screen's face (owner 2026-10-25: "the clock is still not in a good font"; the reference design is set in a soft geometric face): Rubik covers Hebrew AND
// Latin in one family. Used ONLY by the display screen (app/kiosk-display.css); preload is off so no other page downloads it.
const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  preload: false,
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
  // Owner 2026-10-20: in Hebrew (and Arabic) the WHOLE interface mirrors (right-to-left). The server renders the right direction from the locale cookie, so there is no
  // left-to-right flash. Media controls (transport, timeline, volume) stay left-to-right by CSS (the `(rtl)` block in globals.css) — like every media app.
  const dir = LOCALES.find((l) => l.code === locale)?.rtl ? "rtl" : "ltr";
  const lang = locale;

  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        {/* graphics mode (full / lite) is decided before the first paint — see lib/fx-mode.ts */}
        <script dangerouslySetInnerHTML={{ __html: FX_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: KIOSK_BOOT_SCRIPT }} />
        {/* the first paint is already the saved look: display mode + closed rails (owner 2026-11-01) */}
        <script dangerouslySetInnerHTML={{ __html: FIRST_PAINT_BOOT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${heebo.variable} ${rubik.variable} antialiased bg-slate-950 text-slate-50`}
      >
        {children}
        {/* no hover tooltips anywhere (owner 2026-10-26) */}
        <NoNativeTooltips />
      </body>
    </html>
  );
}
