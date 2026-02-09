import { useMemo } from 'react'

interface CategoryData {
  name: string
  tokens: number
  percentage: number
}

const COLORS = [
  '#6366f1', // indigo — system prompt
  '#8b5cf6', // violet — system tools
  '#06b6d4', // cyan — skills
  '#22c55e', // green — messages
  '#404040', // neutral — free space
  '#f59e0b', // amber — autocompact buffer
  '#ef4444', // red — fallback
  '#ec4899', // pink — fallback
]

function parseContextOutput(raw: string): {
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  categories: CategoryData[]
} | null {
  const modelMatch = raw.match(/\*\*Model:\*\*\s*(.+)/)
  const tokensMatch = raw.match(/\*\*Tokens:\*\*\s*([\d.]+k?)\s*\/\s*([\d.]+k?)\s*\((\d+)%\)/)

  if (!tokensMatch) return null

  const parseTokenCount = (s: string): number => {
    if (s.endsWith('k')) return parseFloat(s) * 1000
    return parseFloat(s)
  }

  const categories: CategoryData[] = []
  // Match table rows: | Name | tokens | percentage |
  const rowRegex = /\|\s*([^|]+?)\s*\|\s*([\d,.]+k?)\s*\|\s*([\d.]+)%\s*\|/g
  let match
  while ((match = rowRegex.exec(raw)) !== null) {
    const name = match[1].trim()
    if (name === 'Category' || name.startsWith('-')) continue
    categories.push({
      name,
      tokens: parseTokenCount(match[2].replace(/,/g, '')),
      percentage: parseFloat(match[3]),
    })
  }

  return {
    model: modelMatch?.[1]?.trim() ?? 'Unknown',
    totalTokens: parseTokenCount(tokensMatch[1]),
    maxTokens: parseTokenCount(tokensMatch[2]),
    percentage: parseInt(tokensMatch[3]),
    categories,
  }
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/** SVG donut pie chart for context usage categories. */
function PieChart({ categories }: { categories: CategoryData[] }) {
  const radius = 60
  const cx = 70
  const cy = 70
  const circumference = 2 * Math.PI * radius

  const arcs = useMemo(() => {
    let offset = 0
    return categories.map((cat, i) => {
      const arc = (cat.percentage / 100) * circumference
      const dashOffset = -offset
      offset += arc
      return { ...cat, arc, dashOffset, color: COLORS[i % COLORS.length] }
    })
  }, [categories, circumference])

  return (
    <svg width="140" height="140" viewBox="0 0 140 140" className="mx-auto">
      {/* Background ring */}
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#262626" strokeWidth="16" />
      {/* Category arcs */}
      {arcs.map((a) => (
        <circle
          key={a.name}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={a.color}
          strokeWidth="16"
          strokeDasharray={`${a.arc} ${circumference - a.arc}`}
          strokeDashoffset={a.dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      ))}
    </svg>
  )
}

export function ContextCommandView({ content }: { content: string }) {
  const data = useMemo(() => parseContextOutput(content), [content])

  if (!data) {
    // Fallback to raw text if parsing fails
    return (
      <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{content}</pre>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="text-center">
        <div className="text-sm font-medium text-foreground">{data.model}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatTokens(data.totalTokens)} / {formatTokens(data.maxTokens)} tokens ({data.percentage}%)
        </div>
      </div>

      {/* Pie chart */}
      <PieChart categories={data.categories} />

      {/* Legend */}
      <div className="flex flex-col gap-1.5 px-2">
        {data.categories.map((cat, i) => (
          <div key={cat.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span className="text-foreground">{cat.name}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>{formatTokens(cat.tokens)}</span>
              <span className="w-10 text-right">{cat.percentage.toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
