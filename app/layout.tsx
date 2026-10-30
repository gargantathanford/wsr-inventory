import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Warp Speed Racing — Build Dashboard",
  description:
    "Parts, procurement, tools, procedures and build tracking for the Warp Speed Racing Formula SAE team at OSU-Tulsa.",
  icons: { icon: "/icon.png", apple: "/apple-icon.png" }
};

// themeColor belongs in the viewport export in the App Router, not in metadata.
// Matches graphite-950, so mobile browser chrome blends with the app.
export const viewport: Viewport = {
  themeColor: "#001117"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
