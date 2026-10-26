import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * The app is a local-first install (PRD section 11): system fonts only, no
 * webfont download, and assistant/participant data never leaves this machine.
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
};

export const viewport: Viewport = {
  themeColor: "#fdfbf6",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="h-full">
      <body className="flex min-h-full flex-col bg-cream-50 text-ink-900 antialiased">
        {children}
      </body>
    </html>
  );
}
