import { FileX2 } from 'lucide-react'

export function ActivityWatermark() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileX2 className="size-8 opacity-30" />
      <span className="text-xs">No panels open</span>
    </div>
  )
}
