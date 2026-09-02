import { ArrowLeft, Lock, Unlock } from "lucide-react"
import { notFound } from "next/navigation"
import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { getMcp } from "@/lib/marketplace/api-server"
import { MCPS } from "@/lib/marketplace/mock-db"
import type { McpEntry } from "@/lib/marketplace/types"
import { AvatarTile } from "@/components/marketplace/avatar-tile"
import {
  CopyConfigButton,
  InstallButton,
} from "@/components/marketplace/install-button"

export const dynamic = "force-dynamic"

export function generateStaticParams() {
  return MCPS.map((m) => ({ slug: m.slug }))
}

export default async function McpDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const entry = await getMcp(slug)
  if (!entry) notFound()
  return <McpDetailContent locale={locale as Locale} entry={entry} />
}

function buildMockConfig(entry: McpEntry): string {
  const body =
    entry.transport === "stdio"
      ? {
          command: "npx",
          args: [`-y`, `@modelcontextprotocol/server-${entry.slug}`],
          env: entry.authRequired
            ? { [`${entry.slug.toUpperCase().replace(/-/g, "_")}_TOKEN`]: "<your-token>" }
            : undefined,
        }
      : {
          url: `https://mcp.example.com/${entry.slug}`,
          headers: entry.authRequired
            ? { Authorization: "Bearer <your-token>" }
            : undefined,
        }
  return JSON.stringify(
    { mcpServers: { [entry.slug]: body } },
    null,
    2,
  )
}

function McpDetailContent({
  locale,
  entry,
}: {
  locale: Locale
  entry: McpEntry
}) {
  const t = useTranslations("Mcps")
  const tCat = useTranslations("Mcps.categories")
  const tTransport = useTranslations("Mcps.transport")
  const tStats = useTranslations("Mcps.stats")
  const config = buildMockConfig(entry)

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
      <Link
        href="/mcps"
        className="text-muted-foreground hover:text-foreground mb-10 inline-flex items-center gap-2 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t("detail.back")}
      </Link>

      <header className="border-border bg-card/40 flex flex-col gap-6 rounded-3xl border p-6 sm:flex-row sm:items-start sm:gap-8 sm:p-8">
        <AvatarTile emoji={entry.emoji} hue={entry.hue} size="lg" />
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground/80 text-[12px]">
              {tCat(entry.category)}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/80 text-[12px]">
              {entry.vendor}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                entry.authorType === "official"
                  ? "border-foreground/20 bg-foreground/5"
                  : "border-border/60 text-muted-foreground bg-background"
              }`}
            >
              {entry.authorType === "official" ? t("official") : t("community")}
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {entry.name[locale]}
          </h1>
          <p className="text-muted-foreground text-pretty text-[15px]">
            {entry.tagline[locale]}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <InstallButton kind="mcp" slug={entry.slug} />
            <CopyConfigButton value={config} />
          </div>
        </div>
      </header>

      <section className="mt-12 grid gap-12 md:grid-cols-[1fr_220px]">
        <div className="flex flex-col gap-10">
          <div>
            <h2 className="text-foreground/90 mb-3 text-xs font-semibold uppercase tracking-wider">
              {t("detail.about")}
            </h2>
            <p className="text-foreground/90 text-[15px] leading-relaxed">
              {entry.description[locale]}
            </p>
          </div>

          <div>
            <h2 className="text-foreground/90 mb-3 text-xs font-semibold uppercase tracking-wider">
              {t("detail.tools")}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {entry.highlightedTools.map((tool) => (
                <code
                  key={tool}
                  className="border-border bg-background text-foreground/90 rounded-md border px-2 py-1 font-mono text-[12px]"
                >
                  {tool}
                </code>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-foreground/90 mb-3 text-xs font-semibold uppercase tracking-wider">
              {t("detail.config")}
            </h2>
            <pre className="border-border bg-card text-foreground/90 overflow-x-auto rounded-xl border p-4 font-mono text-[12px] leading-relaxed">
              {config}
            </pre>
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <div>
            <h3 className="text-muted-foreground/80 mb-2 text-[11px] font-semibold uppercase tracking-wider">
              {t("detail.transport")}
            </h3>
            <span className="border-border bg-background inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase">
              {tTransport(entry.transport)}
            </span>
          </div>
          <div>
            <h3 className="text-muted-foreground/80 mb-2 text-[11px] font-semibold uppercase tracking-wider">
              {t("detail.capabilities")}
            </h3>
            <ul className="flex flex-col gap-1.5 text-[13px]">
              <li className="flex justify-between">
                <span className="text-muted-foreground">{tStats("tools")}</span>
                <span className="font-medium tabular-nums">{entry.capabilities.tools}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">{tStats("resources")}</span>
                <span className="font-medium tabular-nums">{entry.capabilities.resources}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">{tStats("prompts")}</span>
                <span className="font-medium tabular-nums">{entry.capabilities.prompts}</span>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-muted-foreground/80 mb-2 text-[11px] font-semibold uppercase tracking-wider">
              Auth
            </h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
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
          <div>
            <h3 className="text-muted-foreground/80 mb-2 text-[11px] font-semibold uppercase tracking-wider">
              Tags
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="border-border bg-background text-muted-foreground rounded-full border px-2.5 py-0.5 text-[11px]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
