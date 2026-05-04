import { useState } from 'react'
import { Mic, Video, Radio } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import { useMiniAppMediaStore } from '@/stores/miniapp-media'
import { useMiniAppStore } from '@/stores/miniapp'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const KIND_ICON = { microphone: Mic, camera: Video } as const
const KIND_LABEL = { microphone: 'Microphone', camera: 'Camera' } as const

export function MiniAppMediaIndicator() {
  const active = useMiniAppMediaStore(useShallow((s) => s.active))
  const apps = useMiniAppStore(useShallow((s) => s.apps))
  const [open, setOpen] = useState(false)

  const entries = Object.entries(active)
  if (entries.length === 0) return null

  const kindsInUse = new Set<'microphone' | 'camera'>()
  for (const [, counts] of entries) {
    for (const k of Object.keys(counts) as Array<'microphone' | 'camera'>) {
      if ((counts[k] ?? 0) > 0) kindsInUse.add(k)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-6 items-center gap-1 rounded-full bg-red-500/10 px-1.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-500/15 dark:text-red-400"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Mini-apps recording"
        >
          <span className="relative flex size-2">
            <motion.span
              className="absolute inline-flex h-full w-full rounded-full bg-red-500"
              animate={{ opacity: [0.7, 0.2, 0.7], scale: [1, 1.6, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="relative inline-flex size-2 rounded-full bg-red-500" />
          </span>
          {kindsInUse.has('microphone') && <Mic className="size-3" />}
          {kindsInUse.has('camera') && <Video className="size-3" />}
          <span>{entries.length}</span>
        </button>
      </PopoverTrigger>
      <AnimatePresence>
        {open && (
          <PopoverContent align="end" sideOffset={6} className="w-72 p-2">
            <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Radio className="size-3" />
              Recording
            </div>
            <div className="space-y-1">
              {entries.map(([appId, counts]) => {
                const app = apps.find((a) => a.id === appId)
                const name = app?.manifest.name ?? appId
                const kinds = (Object.keys(counts) as Array<'microphone' | 'camera'>).filter((k) => (counts[k] ?? 0) > 0)
                return (
                  <div key={appId} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{name}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {kinds.map((k) => {
                          const Icon = KIND_ICON[k]
                          return (
                            <span key={k} className="inline-flex items-center gap-1">
                              <Icon className={cn('size-3', k === 'microphone' ? 'text-red-500' : 'text-orange-500')} />
                              {KIND_LABEL[k]}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </PopoverContent>
        )}
      </AnimatePresence>
    </Popover>
  )
}
