import type { Metadata } from "next"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { getMessages, setRequestLocale } from "next-intl/server"
import { notFound } from "next/navigation"
import "../globals.css"
import { routing } from "@/i18n/routing"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { BrandHueProvider } from "@/components/providers/brand-hue-provider"
import { SiteHeader } from "@/components/site/site-header"

export const metadata: Metadata = {
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
    <html lang={locale} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground flex flex-col">
        <ThemeProvider>
          <BrandHueProvider>
            <NextIntlClientProvider messages={messages} locale={locale}>
              <SiteHeader />
              <div className="flex flex-1 flex-col">{children}</div>
            </NextIntlClientProvider>
          </BrandHueProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
