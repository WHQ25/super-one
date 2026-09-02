import { ArrowUpRight, Lock, Unlock } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import type { McpEntry } from "@/lib/marketplace/types"
import { AvatarTile } from "./avatar-tile"

export function McpCard({
  entry,
  locale,
  variant = "default",
}: {
  entry: McpEntry
  locale: Locale
  variant?: "default" | "featured"
}) {
  const t = useTranslations("Mcps")
  const tCat = useTranslations("Mcps.categories")
  const tTransport = useTranslations("Mcps.transport")
  const tStats = useTranslations("Mcps.stats")
  const featured = variant === "featured"

  return (
    <Link
      href={`/mcps/${entry.slug}`}
      className={`group border-border bg-card/40 hover:border-foreground/20 hover:bg-card/70 relative flex flex-col gap-4 rounded-2xl border p-5 transition-colors ${
        featured ? "sm:p-6" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AvatarTile emoji={entry.emoji} hue={entry.hue} size={featured ? "lg" : "md"} />
          <div className="flex flex-col gap-0.5 pt-0.5">
            <div className="flex items-center gap-2">
              <h3 className={`font-medium tracking-tight ${featured ? "text-xl" : "text-[15px]"}`}>
                {entry.name[locale]}
              </h3>
              {entry.authorType === "official" ? (
                <span className="border-border/60 text-muted-foreground bg-background rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                  {t("official")}
                </span>
              ) : null}
            </div>
            <span className="text-muted-foreground/70 text-[12px]">
              {entry.vendor}
            </span>
          </div>
        </div>
        <ArrowUpRight
          aria-hidden
          className="text-muted-foreground/50 group-hover:text-foreground size-4 transition-colors"
        />
      </div>

      <p
        className={`text-muted-foreground leading-relaxed ${featured ? "text-sm" : "line-clamp-2 text-[13px]"}`}
      >
        {entry.tagline[locale]}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="border-border/60 bg-background text-muted-foreground rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase">
          {tTransport(entry.transport)}
        </span>
        <span className="border-border/60 bg-background text-muted-foreground rounded-full border px-2 py-0.5 text-[10px]">
          {entry.capabilities.tools} {tStats("tools")}
        </span>
        {entry.capabilities.resources > 0 ? (
          <span className="border-border/60 bg-background text-muted-foreground rounded-full border px-2 py-0.5 text-[10px]">
            {entry.capabilities.resources} {tStats("resources")}
          </span>
        ) : null}
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
            entry.authRequired
              ? "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
              : "border-emerald-400/40 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {entry.authRequired ? (
            <Lock className="size-2.5" />
          ) : (
            <Unlock className="size-2.5" />
          )}
          {entry.authRequired ? t("authRequired") : t("noAuth")}
        </span>
      </div>

      <div className="border-border/40 mt-auto border-t pt-3 text-[12px]">
        <span className="text-muted-foreground/80">{tCat(entry.category)}</span>
      </div>
    </Link>
  )
}
