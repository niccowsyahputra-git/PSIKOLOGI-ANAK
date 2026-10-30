import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * The app is a local-first install (PRD section 11): system fonts only, no
 * webfont download, and assistant/participant data never leaves this machine.
 * The UI is a mobile application shell, so it also declares itself installable
 * as a standalone screen rather than a browser document.
 */
export const metadata: Metadata = {
  title: {
    default: "Asesmen Psikososial Panti",
    template: "%s · Asesmen Psikososial Panti",
  },
  description:
    "Sistem asesmen psikososial anak berbasis lokal untuk satu panti asuhan. Data tersimpan di perangkat ini.",
  applicationName: "Asesmen Psikososial Panti",
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Asesmen Panti" },
};

export const viewport: Viewport = {
  themeColor: "#f6f4fd",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  // The app paints under the status bar and home indicator, so iOS safe-area
  // insets become available to the shell. Zoom stays allowed on purpose.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="h-full">
      <body className="min-h-full bg-canvas text-ink-900 antialiased">{children}</body>
    </html>
  );
}
