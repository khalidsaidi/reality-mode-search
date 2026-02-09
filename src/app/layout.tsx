import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Reality Mode Search",
  description: "Search results as returned by the upstream index (no re-ranking)."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

