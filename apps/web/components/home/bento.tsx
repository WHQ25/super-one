"use client"

import type { ReactNode } from "react"
import { motion } from "motion/react"
import { useTranslations } from "next-intl"
import { ArrowUpRight } from "lucide-react"
import {
  SubagentBlockMock,
  ToolBlockMock,
} from "@superone/desktop-mocks/desktop"
import { cn } from "@superone/ui/lib/utils"
import { Link } from "@/i18n/navigation"
import { MockStage } from "./mock-stage"
import { HarnessLineup } from "./harness-lineup"

/**
 * The four product pillars from the repo's own framing, in order. This is the
 * sales pitch, not the sitemap — the taxonomy's six categories live on
 * /features, where they serve people who already use the app.
 *
 * `href` is optional on purpose: collaboration has no features page yet.
 */
const PILLARS = [
  {
    key: "integrate",
    span: "md:col-span-3",
    href: "/features/engines",
    stage: { width: 640, maxHeight: 220 },
    render: () => <HarnessLineup />,
  },
  {
    key: "extend",
    span: "md:col-span-1",
    href: "/features/extend",
    stage: { width: 520, maxHeight: 210 },
    render: () => (
      <ToolBlockMock
        className="p-3"
        defaultExpanded
        spec={{
          variant: "mcp",
          serverName: "superone",
          toolName: "browser_snapshot",
          summary: "Read the rendered page",
          result: "12 interactive elements · 0 console errors",
        }}
      />
    ),
  },
  {
    key: "collaborate",
    span: "md:col-span-1",
    href: undefined,
    stage: { width: 520, maxHeight: 210 },
    render: () => (
      <SubagentBlockMock
        state="running"
        expanded
        subagentType="codex"
        description="Port the relay tests"
      />
    ),
  },
  {
    key: "build",
    span: "md:col-span-1",
    href: "/features/extend/mini-apps",
    stage: { width: 520, maxHeight: 210 },
    render: () => (
      <ToolBlockMock
        className="p-3"
        defaultExpanded
        spec={{
          variant: "mcp",
          serverName: "superone",
          toolName: "miniapp_call",
          summary: "design-canvas · export_frame",
          result: "Wrote hero@2x.png (1200×630)",
        }}
      />
    ),
  },
] as const

const CARD_CLASS =
  "border-border bg-card group flex h-full flex-col gap-5 rounded-2xl border p-6 transition-colors"

function CardShell({
  href,
  children,
}: {
  href?: string
  children: ReactNode
}) {
  if (!href) return <div className={CARD_CLASS}>{children}</div>
  return (
    <Link
      href={href}
      className={cn(
        CARD_CLASS,
        "hover:border-primary/40 hover:bg-accent/30",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      {children}
    </Link>
  )
}

export function Bento() {
  const t = useTranslations("Home.bento")

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mx-auto mb-14 max-w-2xl text-center"
      >
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("heading")}
        </h2>
        <p className="text-muted-foreground mt-4 text-lg">{t("subheading")}</p>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PILLARS.map((pillar, i) => (
          <motion.div
            key={pillar.key}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, ease: "easeOut", delay: i * 0.06 }}
            className={pillar.span}
          >
            <CardShell href={pillar.href}>
              <div>
                <h3 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">
                  {t(`${pillar.key}.title`)}
                  {pillar.href ? (
                    <ArrowUpRight className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  ) : null}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {t(`${pillar.key}.desc`)}
                </p>
              </div>
              <MockStage
                className="mt-auto"
                width={pillar.stage.width}
                maxHeight={pillar.stage.maxHeight}
              >
                {pillar.render()}
              </MockStage>
            </CardShell>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
