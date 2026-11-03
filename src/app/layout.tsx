import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";

import { UiSounds } from "@/components/ui-sounds";
import {
  SITE_DESCRIPTION,
  SITE_TITLE,
  socialMetadata,
} from "@/lib/social-metadata";

import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://play.titanracers.com";

export const metadata: Metadata = {
  ...socialMetadata({
    description: SITE_DESCRIPTION,
    image: "/social-card",
    imageAlt: "Titan Racers: a 1:10 RC kart racing along the levee in Falls View Park",
    title: SITE_TITLE,
  }),
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
