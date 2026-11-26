import type { SVGProps } from 'react'

const BEE_COLORS = [
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
] as const

export function getBeeColor(name?: string): string {
  if (!name) return '#fbbf24'
  const lower = name.trim().toLowerCase()
  if (lower === 'coordinator') return '#f59e0b'
  let hash = 0
  for (let i = 0; i < lower.length; i += 1) {
    hash = (hash * 31 + lower.charCodeAt(i)) | 0
  }
  return BEE_COLORS[Math.abs(hash) % BEE_COLORS.length]!
}

export interface BeeIconProps extends SVGProps<SVGSVGElement> {
  color?: string
  crowned?: boolean
}

const OUTLINE = 'var(--foreground, #1c1917)'

export function BeeIcon({ color = '#fbbf24', crowned = false, ...props }: BeeIconProps) {
  return (
    <svg
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M32 46C24 28 13 24 8 33"
        stroke={OUTLINE}
        strokeWidth={5.5}
        strokeLinecap="round"
      />
      <circle cx="8" cy="33" r="4.5" fill={OUTLINE} />
      <path
        d="M44 43C39 24 31 19 24 25"
        stroke={OUTLINE}
        strokeWidth={5.5}
        strokeLinecap="round"
      />
      <circle cx="24" cy="25" r="4.5" fill={OUTLINE} />

      <path
        d="M40 92C33 101 28 108 23 111"
        stroke={OUTLINE}
        strokeWidth={5}
        strokeLinecap="round"
        opacity="0.65"
      />
      <path
        d="M44 93C38 104 33 111 28 115"
        stroke={OUTLINE}
        strokeWidth={5.5}
        strokeLinecap="round"
      />
      <path
        d="M60 96C58 106 55 113 51 116"
        stroke={OUTLINE}
        strokeWidth={5}
        strokeLinecap="round"
        opacity="0.65"
      />
      <path
        d="M65 96C64 107 62 115 58 118"
        stroke={OUTLINE}
        strokeWidth={5.5}
        strokeLinecap="round"
      />
      <path
        d="M82 94C84 104 83 111 79 114"
        stroke={OUTLINE}
        strokeWidth={5}
        strokeLinecap="round"
        opacity="0.65"
      />
      <path
        d="M87 93C90 104 90 112 86 116"
        stroke={OUTLINE}
        strokeWidth={5.5}
        strokeLinecap="round"
      />

      <path
        d="M112 70L125 70L113 79Z"
        fill={OUTLINE}
        stroke={OUTLINE}
        strokeWidth={3}
        strokeLinejoin="round"
      />

      <path
        d="M18 70C18 52 32 43 52 44C74 44 104 49 114 68C117 75 112 85 100 90C80 98 46 98 30 90C21 85 18 78 18 70Z"
        fill={color}
        stroke={OUTLINE}
        strokeWidth={5.5}
        strokeLinejoin="round"
      />

      <path
        d="M34 52C50 47 74 47 94 54C78 52 54 52 34 56Z"
        fill="#ffffff"
        opacity="0.32"
      />
      <path
        d="M30 85C48 93 78 94 100 86C84 96 50 96 30 88Z"
        fill="#000000"
        opacity="0.22"
      />

      <path
        d="M64 45C68 60 68 80 64 95"
        stroke="#1c1917"
        strokeWidth={10}
        strokeLinecap="round"
      />
      <path
        d="M84 48C89 62 89 79 84 92"
        stroke="#1c1917"
        strokeWidth={10}
        strokeLinecap="round"
      />
      <path
        d="M102 55C106 65 106 77 101 86"
        stroke="#1c1917"
        strokeWidth={8.5}
        strokeLinecap="round"
      />

      <ellipse cx="34" cy="67" rx="8.5" ry="11" fill="#1c1917" />
      <circle cx="36.5" cy="62.5" r="3.2" fill="#ffffff" />
      <circle cx="32" cy="70.5" r="1.6" fill="#ffffff" opacity="0.75" />
      <ellipse cx="39" cy="80" rx="5" ry="3" fill="#fb7185" opacity="0.75" />
      <path
        d="M23 79C26 83 31 83 34 80"
        stroke="#1c1917"
        strokeWidth={3.2}
        strokeLinecap="round"
      />

      <path
        d="M48 48C40 12 74 2 92 18C104 29 90 50 62 52Z"
        fill="rgba(186, 230, 253, 0.34)"
        stroke={OUTLINE}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <path
        d="M70 48C74 16 108 12 118 28C124 41 106 55 76 54Z"
        fill="rgba(224, 242, 254, 0.24)"
        stroke={OUTLINE}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      {crowned && (
        <g>
          <path
            d="M11 44L5 14L23 26L34 6L45 26L61 14L54 44Z"
            fill="#facc15"
            stroke={OUTLINE}
            strokeWidth={5.5}
            strokeLinejoin="round"
          />
          <circle cx="34" cy="34" r="3.5" fill="#ef4444" />
        </g>
      )}
    </svg>
  )
}
