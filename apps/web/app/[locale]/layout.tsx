import type { Metadata } from "next"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { getMessages, setRequestLocale } from "next-intl/server"
import { notFound } from "next/navigation"
import {
  Geist,
  Fraunces,
  Inter_Tight,
  Noto_Sans_SC,
  Noto_Serif_SC,
} from "next/font/google"
import "../globals.css"
import { routing } from "@/i18n/routing"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { BrandHueProvider } from "@/components/providers/brand-hue-provider"
import { SiteHeader } from "@/components/site/site-header"
import { SiteFooter } from "@/components/site/site-footer"

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
})

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
})

const notoSansSC = Noto_Sans_SC({
  weight: ["500", "600", "700", "900"],
  variable: "--font-display-cjk",
  display: "swap",
  preload: false,
})

const notoSerifSC = Noto_Serif_SC({
  weight: ["400", "500"],
  variable: "--font-serif-cjk",
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  metadataBase: new URL("https://super-one.dev"),
  title: "SuperOne",
  description: "Every coding agent on one surface — integrated, extended, working together.",
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)

  const messages = await getMessages()

  return (
    <html
      lang={locale}
      className={`${geist.variable} ${fraunces.variable} ${interTight.variable} ${notoSansSC.variable} ${notoSerifSC.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground flex flex-col">
        <ThemeProvider>
          <BrandHueProvider>
            <NextIntlClientProvider messages={messages} locale={locale}>
              <SiteHeader />
              <div className="flex flex-1 flex-col">{children}</div>
              <SiteFooter />
            </NextIntlClientProvider>
          </BrandHueProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
