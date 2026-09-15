import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { TooltipProvider } from "@cloudflare/kumo";
import { AppToaster } from "@/components/app-toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Outpost",
  description: "A voice chat platform for your community.",
  icons: {
    icon: [
      { url: "/outpost-icon-120.webp", type: "image/webp", sizes: "120x120" },
      { url: "/outpost-icon-350.webp", type: "image/webp", sizes: "350x350" },
    ],
    apple: "/outpost-icon-350.webp",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-mode="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClerkProvider
          dynamic
          appearance={{
            baseTheme: dark,
            variables: {
              colorPrimary: "#5865f2",
              colorBackground: "#313338",
              colorInputBackground: "#1e1f22",
              colorText: "#dbdee1",
            },
          }}
        >
          <ConvexClientProvider>
            <TooltipProvider delay={200}>
              <AppToaster>{children}</AppToaster>
            </TooltipProvider>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
