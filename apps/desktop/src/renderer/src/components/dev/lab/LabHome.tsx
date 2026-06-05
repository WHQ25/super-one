import logoUrl from '@/assets/logo-text-inline.png'
import { LABS } from './registry'

export function LabHome({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 gap-10">
      <img src={logoUrl} alt="SuperOne" draggable={false} className="h-20 w-auto select-none" />
      <div className="flex flex-col gap-3 w-full max-w-xl">
        {LABS.map((lab) => (
          <button
            key={lab.id}
            onClick={() => onOpen(lab.id)}
            className="text-left rounded-xl border border-border bg-card hover:bg-accent transition-colors px-5 py-4"
          >
            <div className="font-semibold">{lab.title}</div>
            <div className="text-sm text-muted-foreground mt-1">{lab.description}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
