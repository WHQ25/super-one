import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ContextChip, ContextPreviewContent } from './ContextChip'
import type { MiniAppContextSlot } from '@/stores/chat'

interface ContextBarProps {
  contexts: Record<string, MiniAppContextSlot>
  onToggle: (appId: string) => void
  onDismiss: (appId: string) => void
}

export function ContextBar({ contexts, onToggle, onDismiss }: ContextBarProps) {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const slots = Object.values(contexts)
  if (slots.length === 0) return null

  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {slots.map((slot) => (
        <Popover
          key={slot.appId}
          open={previewId === slot.appId}
          onOpenChange={(open) => setPreviewId(open ? slot.appId : null)}
        >
          <PopoverTrigger asChild>
            <span>
              <ContextChip
                slot={slot}
                onToggle={() => onToggle(slot.appId)}
                onDismiss={() => onDismiss(slot.appId)}
                onClick={() => setPreviewId(previewId === slot.appId ? null : slot.appId)}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-80 p-3"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <ContextPreviewContent appName={slot.appName} summary={slot.summary} content={slot.content} />
          </PopoverContent>
        </Popover>
      ))}
    </div>
  )
}
