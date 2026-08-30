import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AdminSessionProvider } from "@/components/admin/session-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Prospecta Construções | Construindo o seu futuro",
    template: "%s | Prospecta Construções",
  },
  description:
    "Especialistas em corretagem, construção, reforma, financiamento habitacional, lotes, regularização imobiliária e engenharia.",
  keywords: [
    "imóveis",
    "corretagem",
    "financiamento habitacional",
    "lotes",
    "construção",
    "reforma",
    "regularização imobiliária",
    "engenharia",
    "Prospecta Construções",
  ],
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Prospecta Construções",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
          <AdminSessionProvider>{children}</AdminSessionProvider>
        </body>
    </html>
  );
}
