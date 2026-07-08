import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Titan Racers",
  description: "Play Titan Racers.",
  metadataBase: new URL("https://play.titanracers.com"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
