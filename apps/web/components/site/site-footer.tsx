import Image from "next/image"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { LocaleSwitcher } from "./locale-switcher"

export function SiteFooter() {
  const t = useTranslations("Footer")
  const tn = useTranslations("Nav")

  const columns = [
    {
      title: t("product"),
      links: [
        { label: tn("demos"), href: "/demos" as const },
        { label: tn("docs"), href: "/docs" as const },
      ],
    },
    {
      title: t("resources"),
      links: [
        { label: t("links.changelog"), href: "/changelog" as const },
        { label: t("links.github"), href: "/docs" as const },
      ],
    },
    {
      title: t("company"),
      links: [
        { label: t("links.about"), href: "/docs" as const },
        { label: t("links.privacy"), href: "/docs" as const },
      ],
    },
  ]

  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="flex flex-col items-start">
          <Image
            src="/logo/wordmark-stacked.webp"
            alt="SuperOne"
            width={692}
            height={512}
            className="h-24 w-auto"
          />
        </div>
        {columns.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <span className="text-sm font-medium">{col.title}</span>
            <ul className="flex flex-col gap-2">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col items-start gap-3 px-4 py-6 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-4">
            <span>© {new Date().getFullYear()} SuperOne</span>
            <span>{t("rights")}</span>
          </div>
          <LocaleSwitcher />
        </div>
      </div>
    </footer>
  )
}
