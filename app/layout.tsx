import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#f3f0e9",
  colorScheme: "light",
};

export const metadata: Metadata = {
  title: {
    default: "Markroom — Shared PDF review",
    template: "%s — Markroom",
  },
  description: "Put one PDF in one shared review room and keep every comment together.",
  applicationName: "Markroom",
  openGraph: {
    type: "website",
    title: "One PDF. One review record.",
    description: "A shared room for page-specific PDF comments, update checks, and one reviewed export.",
    siteName: "Markroom",
  },
  twitter: {
    card: "summary",
    title: "One PDF. One review record.",
    description: "Shared PDF comments without duplicate document copies.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="site-footer">
          <span>© 2026 Damn Kitty Works LLC</span>
          <a href="https://github.com/damnkittyworks/markroom">Source code</a>
        </footer>
      </body>
    </html>
  );
}
