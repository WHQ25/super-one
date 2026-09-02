type Size = "sm" | "md" | "lg"

const SIZE_CLASS: Record<Size, string> = {
  sm: "size-10 text-lg",
  md: "size-12 text-2xl",
  lg: "size-16 text-4xl",
}

export function AvatarTile({
  emoji,
  hue,
  size = "md",
}: {
  emoji: string
  hue: number
  size?: Size
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl border ${SIZE_CLASS[size]}`}
      style={{
        background: `linear-gradient(135deg, oklch(0.95 0.04 ${hue}), oklch(0.86 0.08 ${hue}))`,
        borderColor: `oklch(0.78 0.06 ${hue})`,
      }}
      aria-hidden
    >
      <span className="drop-shadow-sm">{emoji}</span>
    </div>
  )
}
