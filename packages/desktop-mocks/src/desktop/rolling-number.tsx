"use client"

import { motion } from "motion/react"
import { cn } from "@superone/ui/lib/utils"

function RollingDigit({ char }: { char: string }) {
  if (!/\d/.test(char)) return <span>{char}</span>
  const target = Number(char)
  return (
    <span
      className="relative inline-block overflow-hidden align-baseline"
      style={{ width: "1ch", height: "1em", lineHeight: "1em" }}
    >
      <span aria-hidden className="invisible">0</span>
      <motion.span
        className="absolute inset-x-0 top-0"
        initial={{ y: 0 }}
        animate={{ y: `-${target}em` }}
        transition={{ type: "spring", stiffness: 360, damping: 30, mass: 0.6 }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span
            key={n}
            className="block text-center"
            style={{ height: "1em", lineHeight: "1em" }}
          >
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  )
}

function StaticDigit({ char }: { char: string }) {
  return <span className="inline-block text-center" style={{ width: "1ch" }}>{char}</span>
}

export interface RollingNumberProps {
  value: number
  frame?: number
  className?: string
}

export function RollingNumber({ value, frame, className }: RollingNumberProps) {
  const isFrameDriven = frame !== undefined
  const digits = String(Math.max(0, Math.floor(value))).split("")
  return (
    <span className={cn("inline-flex items-baseline tabular-nums", className)}>
      {digits.map((d, i) =>
        isFrameDriven ? (
          <StaticDigit key={digits.length - 1 - i} char={d} />
        ) : (
          <RollingDigit key={digits.length - 1 - i} char={d} />
        ),
      )}
    </span>
  )
}
