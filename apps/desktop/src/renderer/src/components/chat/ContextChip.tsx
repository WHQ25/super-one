import { X, Check, Square } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { deriveColors } from '@superone/ui/lib/context-colors'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useIsDark } from '@/hooks/use-is-dark'
import type { MiniAppContextSlot } from '@/stores/chat'

interface ContextChipProps {
  slot: MiniAppContextSlot
  onToggle: () => void
  onDismiss: () => void
  onClick: () => void
}

export function ContextChip({ slot, onToggle, onDismiss, onClick }: ContextChipProps) {
  const isDark = useIsDark()
  const colors = deriveColors(slot.color, isDark)
  const isSuggest = slot.mode === 'suggest'
  const isActive = isSuggest ? slot.checked : true

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap select-none transition-opacity',
        !isActive && 'opacity-60',
      )}
      style={{
        background: isActive ? colors.bg : 'transparent',
        border: isSuggest && !isActive
          ? `1px dashed ${colors.border}`
          : `1px solid ${isActive ? colors.bg : 'transparent'}`,
      }}
    >
      <MiniAppIcon appId={slot.appId} className="size-3 shrink-0" />
      <button
        type="button"
        className="max-w-35 truncate font-medium cursor-pointer"
        style={{ color: colors.color }}
        onClick={onClick}
      >
        {slot.appName}
      </button>
      {slot.summary && (
        <>
          <span style={{ color: colors.labelColor, fontSize: 10 }}>·</span>
          <button
            type="button"
            className="max-w-35 truncate cursor-pointer"
            style={{ color: colors.labelColor, fontSize: 11 }}
            onClick={onClick}
          >
            {slot.summary}
          </button>
        </>
      )}
      {isSuggest ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          className="ml-0.5 cursor-pointer"
          style={{ color: colors.color }}
        >
          {slot.checked ? <Check className="size-3" /> : <Square className="size-3" />}
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss() }}
          className="ml-0.5 cursor-pointer"
          style={{ color: colors.labelColor, opacity: 0.7 }}
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  )
}
