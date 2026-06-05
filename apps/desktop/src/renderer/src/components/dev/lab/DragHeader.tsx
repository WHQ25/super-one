import type React from 'react'

const isMac = typeof window !== 'undefined' && window.app?.platform === 'darwin'
const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function DragHeader({ title, onBack }: { title?: string; onBack?: () => void }) {
  return (
    <header
      className="flex items-center gap-3 h-10 shrink-0 border-b border-border bg-sidebar select-none"
      style={{ ...dragStyle, paddingLeft: isMac ? 80 : 12, paddingRight: 12 }}
    >
      {onBack && (
        <button
          onClick={onBack}
          style={noDragStyle}
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          ← 返回
        </button>
      )}
      <span className="text-sm font-medium opacity-80">{title ?? 'SuperOne Labs'}</span>
    </header>
  )
}
