import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev Caro",
  description: "Human vs Jev decision model in a 15x15 Caro game.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Browser extensions may inject root attributes (for example, class="mdl-js") before hydration.
    <html lang="vi" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
