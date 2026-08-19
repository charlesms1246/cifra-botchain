import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import Ribbons from "@/components/ui/ribbons";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const malinton = localFont({
  variable: "--font-malinton",
  src: [
    { path: "../fonts/MalintonTrialVersion-Regular.otf", weight: "400", style: "normal" },
    { path: "../fonts/MalintonTrialVersion-SemiBold.otf", weight: "600", style: "normal" },
    { path: "../fonts/MalintonTrialVersion-Bold.otf", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Cifra — Private Invoice Factoring on Flare",
  description:
    "Suppliers factor invoices for FXRP liquidity. Buyer credit is scored privately inside a TEE — only a signed risk grade reaches the chain.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${malinton.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full font-sans">
        <Providers>
          <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
            <Ribbons
              baseThickness={40}
              colors={["#DE7356", "#eeeeee"]}
              speedMultiplier={0.52}
              enableFade={false}
              enableShaderEffect={false}
            />
          </div>
          <Header />
          <main className="relative z-10 min-h-[calc(100vh-4rem)]">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
