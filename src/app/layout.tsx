import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";

import { UiSounds } from "@/components/ui-sounds";

import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://play.titanracers.com";

export const metadata: Metadata = {
  title: "Titan Racers",
  description: "Play Titan Racers.",
  metadataBase: new URL(appUrl),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <UiSounds />
        <Analytics />
      </body>
    </html>
  );
}
