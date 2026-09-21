import type { Metadata } from "next";
import { Fraunces, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeProvider";
import PageTransition from "@/components/PageTransition";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["600","700","800","900"],
});
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-workhorse",
  display: "swap",
  weight: ["400","500","600","700"],
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400","500"] });

export const metadata: Metadata = {
  title: "NEXORA — Editorial Intelligence for Ambitious Students",
  description: "A curated, AI-augmented atlas of scholarships, fellowships, internships and hackathons. Parchment calm, ink precision.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${sora.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground" style={{ fontFamily: "var(--font-workhorse)" }}>
        <ThemeProvider>
          <AuthProvider>
            <PageTransition>{children}</PageTransition>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
