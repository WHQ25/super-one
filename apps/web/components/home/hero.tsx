"use client"

import { AnimatePresence, motion } from "motion/react"
import { useTranslations } from "next-intl"
import { useEffect, useRef, useState } from "react"
import { Button } from "@superone/ui/components/ui/button"
import { Link } from "@/i18n/navigation"
import { DownloadButton } from "@/components/download-button"
import {
  HARNESS_HUE,
  HarnessAgentIcon,
  NewSessionMock,
  type Harness,
} from "@superone/desktop-mocks/desktop"
import { MockStage } from "./mock-stage"
import { useElementSize } from "@/lib/use-element-size"

const fade = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
}

/** Every harness SuperOne can drive, not just the two it launched with. */
const HARNESS_CYCLE: Harness[] = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "dsh",
  "acp",
]
const HARNESS_CYCLE_MS = 2800

const CELL_HUE_CHROMA: [number, number][] = [
  [45, 0.18],
  [90, 0.17],
  [140, 0.18],
  [210, 0.13],
  [260, 0.2],
  [320, 0.2],
]

type Cell = {
  id: number
  left: string
  top: string
  hue: number
  c: number
  dur: number
}

function makeCell(): Cell {
  let x = 0
  let y = 0
  for (let i = 0; i < 16; i++) {
    x = 2 + Math.random() * 94
    y = 2 + Math.random() * 94
    if (!(x > 26 && x < 74 && y > 20 && y < 70)) break
  }
  const pick =
    CELL_HUE_CHROMA[Math.floor(Math.random() * CELL_HUE_CHROMA.length)]!
  return {
    id: Math.random(),
    left: `${x}%`,
    top: `${y}%`,
    hue: pick[0],
    c: pick[1],
    dur: 3.6 + Math.random() * 2.2,
  }
}

export function Hero() {
  const t = useTranslations("Home.hero")
  const [harnessIndex, setHarnessIndex] = useState(0)
  const currentHarness = HARNESS_CYCLE[harnessIndex] ?? "claude"
  const [cells, setCells] = useState<Cell[]>([])
  const [avatarSlotRef, avatarSlot] = useElementSize<HTMLSpanElement>()
  const avatarPx = Math.round(avatarSlot.width) || 64
  const sectionRef = useRef<HTMLElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = window.setInterval(() => {
      setHarnessIndex((i) => (i + 1) % HARNESS_CYCLE.length)
    }, HARNESS_CYCLE_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    // Seeded here rather than in useState because every cell is randomised, so a
    // server-rendered value would not match hydration. This is one write on mount
    // for a decorative grid, not the cascade the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCells(Array.from({ length: 7 }, () => makeCell()))
    const id = window.setInterval(() => {
      setCells((prev) => (prev.length >= 14 ? prev : [...prev, makeCell()]))
    }, 650)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const section = sectionRef.current
    const spot = spotlightRef.current
    if (!section || !spot) return
    let raf = 0
    const applyMask = (x: number, y: number) => {
      const mask = `radial-gradient(520px circle at ${x}px ${y}px, black 0%, transparent 75%)`
      spot.style.maskImage = mask
      spot.style.webkitMaskImage = mask
    }
    const onMove = (e: MouseEvent) => {
      const rect = section.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        applyMask(x, y)
        spot.style.opacity = "0.22"
      })
    }
    const onLeave = () => {
      cancelAnimationFrame(raf)
      spot.style.opacity = "0"
    }
    section.addEventListener("mousemove", onMove)
    section.addEventListener("mouseleave", onLeave)
    return () => {
      cancelAnimationFrame(raf)
      section.removeEventListener("mousemove", onMove)
      section.removeEventListener("mouseleave", onLeave)
    }
  }, [])

  const line1 = t("titleLine1")
  const line2 = t("titleLine2")
  const accent = t("titleAccent")
  const line1Words = line1.split(" ")

  return (
    <section
      ref={sectionRef}
      className="relative isolate overflow-hidden pt-10 pb-16 sm:pt-14 lg:pt-16"
    >
      {/* === BACKGROUND — Pixel Cell Mosaic (LEGO-inspired), dark+light share structure === */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20 overflow-hidden"
      >
        {/* base */}
        <div className="absolute inset-0 bg-background" />

        {/* subtle central ambient — keeps text legible */}
        <div
          className="absolute left-1/2 top-[42%] h-[1000px] w-[1200px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-[100px]"
          style={{
            background:
              "radial-gradient(circle, oklch(0.85 0.04 260 / 0.35) 0%, transparent 65%)",
          }}
        />

        {/* Cell grid — ambient (faint) */}
        <div
          className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            color: "var(--foreground)",
            maskImage:
              "radial-gradient(ellipse 90% 80% at 50% 40%, black 35%, transparent 92%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 90% 80% at 50% 40%, black 35%, transparent 92%)",
          }}
        />

        {/* Cell grid — spotlight (follows cursor, brighter near mouse) */}
        <div
          ref={spotlightRef}
          className="absolute inset-0 opacity-0 transition-opacity duration-300"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            color: "var(--foreground)",
          }}
        />

        {/* Highlight cells — randomly spawning, LEGO-logo color palette */}
        {cells.map((c) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, scale: 0.45 }}
            animate={{
              opacity: [0, 0.85, 0.7, 0.85, 0],
              scale: [0.45, 1, 0.97, 1, 0.45],
            }}
            transition={{
              duration: c.dur,
              times: [0, 0.18, 0.5, 0.82, 1],
              ease: "easeInOut",
            }}
            onAnimationComplete={() =>
              setCells((prev) => prev.filter((x) => x.id !== c.id))
            }
            className="absolute h-12 w-12 rounded-[3px]"
            style={{
              left: c.left,
              top: c.top,
              background: `oklch(0.65 ${c.c} ${c.hue} / 0.5)`,
              boxShadow: `0 0 28px oklch(0.65 ${c.c} ${c.hue} / 0.35), inset 0 0 0 1px oklch(0.85 ${c.c} ${c.hue} / 0.4)`,
            }}
          />
        ))}

        {/* tiny dot inside each grid cell — like LEGO stud subtle hint */}
        <div
          className="absolute inset-0 opacity-[0.12] dark:opacity-[0.10]"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 0.9px, transparent 1.3px)",
            backgroundSize: "56px 56px",
            backgroundPosition: "28px 28px",
            color: "var(--foreground)",
            maskImage:
              "radial-gradient(ellipse 90% 80% at 50% 40%, black 30%, transparent 90%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 90% 80% at 50% 40%, black 30%, transparent 90%)",
          }}
        />

        {/* grain — dark only */}
        <div
          className="absolute inset-0 hidden opacity-[0.05] mix-blend-overlay dark:block"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>\")",
          }}
        />

        {/* vignettes */}
        <div className="from-background absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent" />
        <div className="to-background absolute inset-x-0 bottom-0 h-[35%] bg-gradient-to-b from-transparent" />
      </div>

      {/* === CONTENT === */}
      <div className="relative mx-auto flex w-full max-w-7xl flex-col items-center px-4 text-center sm:px-6 xl:max-w-[88rem]">
        {/* badge */}
        <motion.div
          variants={fade}
          initial="hidden"
          animate="show"
          transition={{ duration: 0.5, ease: "easeOut", delay: 0.06 }}
        >
          <span
            className="border-border/70 bg-card/40 text-foreground/80 supports-[backdrop-filter]:bg-card/30 relative inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium tracking-wide backdrop-blur-md"
            style={{
              boxShadow:
                "0 1px 0 0 oklch(1 0 0 / 0.08) inset, 0 8px 30px -10px oklch(0.6 0.2 240 / 0.35)",
            }}
          >
            <span
              className="bg-primary dark:bg-[oklch(0.78_0.2_240)] h-1.5 w-1.5 rounded-full"
              style={{ animation: "badge-pulse 2.4s ease-in-out infinite" }}
            />
            {t("badge")}
          </span>
        </motion.div>

        {/* headline — 3 lines, each with its own treatment */}
        <h1
          className="mt-8 w-full text-balance text-5xl leading-[1.02] font-semibold tracking-[-0.04em] sm:text-6xl md:text-7xl lg:text-[6rem] xl:text-[7rem]"
          style={{
            fontFamily:
              "var(--font-display), var(--font-display-cjk), var(--font-sans), sans-serif",
          }}
        >
          {/* Group: Line 1 + Line 2 — always stacked */}
          <span className="flex flex-col items-center">
            {/* Line 1 — sans, per-word stagger blur-in */}
            <span className="block whitespace-nowrap">
              {line1Words.map((word, i) => (
                <motion.span
                  key={`${word}-${i}`}
                  initial={{ opacity: 0, y: 28, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{
                    duration: 0.65,
                    delay: 0.18 + i * 0.06,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="mr-[0.22em] inline-block last:mr-0"
                >
                  {word}
                </motion.span>
              ))}
            </span>

            {/* Line 2 — sans + cycling harness avatar */}
            <motion.span
              initial={{ opacity: 0, y: 28, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{
                duration: 0.7,
                delay: 0.18 + line1Words.length * 0.06 + 0.05,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="mt-1 flex items-center justify-center gap-[0.3em] whitespace-nowrap"
            >
            <span>{line2}</span>
            {/* Avatar slot — fixed-width so the line does not reflow. The slot is
                sized in `em`, but HarnessAgentIcon falls back to the sidebar icons
                for harnesses without a large mark, and those lay their parts out
                from the numeric `size`. Measure the slot and hand over the real
                pixel value, or the body scales while the legs stay put. */}
            <span
              ref={avatarSlotRef}
              className="relative inline-flex aspect-square h-[0.92em] items-center justify-center overflow-visible align-middle"
              aria-hidden
            >
              <AnimatePresence mode="wait">
                <motion.span
                  key={currentHarness}
                  initial={{ opacity: 0, scale: 0.6, rotate: -25, y: 4 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
                  exit={{ opacity: 0, scale: 0.6, rotate: 25, y: -4 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    filter: `drop-shadow(0 6px 18px oklch(0.65 0.2 ${HARNESS_HUE[currentHarness]} / 0.45))`,
                  }}
                >
                  <HarnessAgentIcon
                    harness={currentHarness}
                    className="size-full"
                    size={avatarPx}
                  />
                </motion.span>
              </AnimatePresence>
            </span>
            </motion.span>
          </span>

          {/* Line 3 — italic serif gradient accent */}
          <motion.span
            initial={{ opacity: 0, y: 28, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{
              duration: 0.8,
              delay: 0.18 + line1Words.length * 0.06 + 0.18,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="mt-2 block text-5xl font-medium sm:text-6xl md:text-7xl lg:text-[5.5rem] xl:text-[6.25rem]"
            style={{
              fontFamily:
                'var(--font-serif), var(--font-serif-cjk), "Songti SC", "STSong", Georgia, serif',
              fontOpticalSizing: "auto",
              backgroundImage:
                "linear-gradient(100deg, oklch(0.74 0.18 50), oklch(0.86 0.17 90), oklch(0.76 0.18 140), oklch(0.62 0.17 250), oklch(0.72 0.13 210), oklch(0.56 0.18 320), oklch(0.74 0.18 50), oklch(0.86 0.17 90), oklch(0.76 0.18 140), oklch(0.62 0.17 250), oklch(0.72 0.13 210), oklch(0.56 0.18 320), oklch(0.74 0.18 50))",
              backgroundSize: "300% 100%",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              letterSpacing: "-0.025em",
              animation: "accent-shift 9s linear infinite",
            }}
          >
            {accent}
          </motion.span>
        </h1>

        {/* tagline */}
        <motion.p
          variants={fade}
          initial="hidden"
          animate="show"
          transition={{
            duration: 0.55,
            ease: "easeOut",
            delay: 0.18 + line1Words.length * 0.06 + 0.38,
          }}
          className="text-muted-foreground mt-7 max-w-xl text-pretty text-sm sm:text-base"
        >
          {t("tagline")}
        </motion.p>

        {/* CTAs */}
        <motion.div
          id="download"
          variants={fade}
          initial="hidden"
          animate="show"
          transition={{
            duration: 0.55,
            ease: "easeOut",
            delay: 0.18 + line1Words.length * 0.06 + 0.45,
          }}
          className="relative mt-9 flex scroll-mt-24 flex-col items-center gap-3 sm:flex-row"
        >
          <DownloadButton />
          <Button
            size="lg"
            variant="outline"
            asChild
            className="border-border/60 bg-card/30 hover:bg-card/60 rounded-full px-5 text-base font-semibold tracking-tight backdrop-blur duration-200 hover:scale-105"
          >
            <Link href="/docs">{t("secondary")}</Link>
          </Button>
        </motion.div>

        {/* preview surface with glow halo */}
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: 0.9,
            ease: [0.22, 1, 0.36, 1],
            delay: 0.18 + line1Words.length * 0.06 + 0.55,
          }}
          className="relative mt-16 w-full max-w-6xl"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-10 -top-12 -bottom-4 -z-10 hidden dark:block"
            style={{
              background:
                "radial-gradient(60% 50% at 50% 50%, oklch(0.6 0.22 260 / 0.35), transparent 70%)",
              filter: "blur(40px)",
            }}
          />
          <div className="relative">
            <MockStage
              className="shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
              width={980}
            >
              <NewSessionMock
                defaultHarness="codex"
                height={620}
                showActivityPanelToggle
                showTerminalToggle
              />
            </MockStage>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-0 hidden h-px dark:block"
              style={{
                background:
                  "linear-gradient(90deg, transparent, oklch(0.9 0.15 240 / 0.7), transparent)",
                backgroundSize: "200% 100%",
                animation: "shimmer-line 6s linear infinite",
              }}
            />
          </div>
        </motion.div>
      </div>
    </section>
  )
}
