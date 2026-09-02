"use client"

import { motion } from "motion/react"
import { useTranslations } from "next-intl"
import {
  CollaborationMock,
  RealtimeVoiceMock,
} from "@superone/desktop-mocks/desktop"
import { cn } from "@superone/ui/lib/utils"
import { MockStage } from "./mock-stage"

/**
 * Two full-width alternating rows for the capabilities that need room to read.
 * These absorbed what used to live in <ProductShowcase>, so each mock appears
 * exactly once on the page.
 */
const ROWS = [
  {
    key: "collab",
    render: () => <CollaborationMock />,
  },
  {
    key: "voice",
    render: () => (
      <RealtimeVoiceMock
        defaultView="realtime"
        defaultVoiceState="active"
        speakingSegmentIds={["call-2-assistant-1"]}
      />
    ),
  },
] as const

export function FeatureRows() {
  const t = useTranslations("Home.rows")

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <motion.h2
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-20 text-center text-3xl font-semibold tracking-tight sm:text-4xl"
      >
        {t("heading")}
      </motion.h2>

      <div className="flex flex-col gap-24">
        {ROWS.map((row, i) => {
          const reversed = i % 2 === 1
          return (
            <div
              key={row.key}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              <motion.div
                initial={{ opacity: 0, x: reversed ? 40 : -40 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
                className={reversed ? "lg:order-2" : ""}
              >
                <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {t(`${row.key}.title`)}
                </h3>
                <p className="text-muted-foreground mt-4 text-lg leading-relaxed">
                  {t(`${row.key}.desc`)}
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className={cn(reversed && "lg:order-1")}
              >
                <MockStage
                  className="shadow-sm"
                  width={560}
                >
                  {row.render()}
                </MockStage>
              </motion.div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
