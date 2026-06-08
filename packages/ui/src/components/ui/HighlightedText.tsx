export function HighlightedText({
  text,
  indices,
  className,
  highlightClassName = 'text-primary font-medium',
}: {
  text: string
  indices: number[]
  className?: string
  highlightClassName?: string
}) {
  if (indices.length === 0) return <span className={className}>{text}</span>

  const indexSet = new Set(indices)
  const parts: { text: string; highlight: boolean }[] = []
  let current = ''
  let isHighlight = false

  for (let i = 0; i < text.length; i++) {
    const shouldHighlight = indexSet.has(i)
    if (shouldHighlight !== isHighlight) {
      if (current) parts.push({ text: current, highlight: isHighlight })
      current = ''
      isHighlight = shouldHighlight
    }
    current += text[i]
  }
  if (current) parts.push({ text: current, highlight: isHighlight })

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.highlight ? (
          <span key={i} className={highlightClassName}>{p.text}</span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  )
}
