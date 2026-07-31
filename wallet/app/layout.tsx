import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "mallow · agent-native wallet",
  description: "A wallet that thinks with you.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div
          role="status"
          style={{
            background: "#fff4d8",
            borderBottom: "1px solid rgba(127, 83, 0, 0.22)",
            color: "#5f3b00",
            fontFamily: "var(--font-geist-sans)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0,
            lineHeight: 1.4,
            padding: "6px 12px",
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            textAlign: "center",
            zIndex: 1000,
          }}
        >
          Mallow is under development. Use small test amounts only.
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
