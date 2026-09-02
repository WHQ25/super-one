import { ArrowUpRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import type { SkillEntry } from "@/lib/marketplace/types"
import { AvatarTile } from "./avatar-tile"

export function SkillCard({
  entry,
  locale,
  variant = "default",
}: {
  entry: SkillEntry
  locale: Locale
  variant?: "default" | "featured"
}) {
  const t = useTranslations("Skills")
  const tCat = useTranslations("Skills.categories")
  const featured = variant === "featured"

  return (
    <Link
      href={`/skills/${entry.slug}`}
      className={`group border-border bg-card/40 hover:border-foreground/20 hover:bg-card/70 relative flex flex-col gap-4 rounded-2xl border p-5 transition-colors ${
        featured ? "sm:p-6" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <AvatarTile emoji={entry.emoji} hue={entry.hue} size={featured ? "lg" : "md"} />
        <ArrowUpRight
          aria-hidden
          className="text-muted-foreground/50 group-hover:text-foreground size-4 transition-colors"
        />
      </div>
      <div className="flex flex-col gap-1.5">
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
        <p
          className={`text-muted-foreground leading-relaxed ${featured ? "text-sm" : "line-clamp-2 text-[13px]"}`}
        >
          {entry.tagline[locale]}
        </p>
      </div>
      <div className="border-border/40 mt-auto flex items-center justify-between gap-3 border-t pt-3 text-[12px]">
        <span className="text-muted-foreground/80">{tCat(entry.category)}</span>
        <span className="text-muted-foreground/60 truncate">
          {t("byAuthor", { name: entry.authorName })}
        </span>
      </div>
    </Link>
  )
}
