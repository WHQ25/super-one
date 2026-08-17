import { AlertCircle, Image } from 'lucide-react'
import { useImageDataUri } from './image-shared'

export function MediaParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-all font-medium text-foreground">{value}</span>
    </div>
  )
}

export function MediaImageRefThumb({ path, label }: { path: string; label: string }) {
  const { dataUri, loadError } = useImageDataUri(path, false)

  return (
    <div className="flex w-16 flex-none flex-col gap-1">
      <div className="h-16 w-16 overflow-hidden rounded-md border border-border bg-muted/30">
        {loadError ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <AlertCircle className="size-3" />
          </div>
        ) : dataUri ? (
          <img src={dataUri} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Image className="size-4" />
          </div>
        )}
      </div>
      <span className="truncate text-center text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
