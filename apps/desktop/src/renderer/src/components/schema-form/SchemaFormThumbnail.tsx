import { useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { SchemaFormImage } from '@superone/shared/schema-form'

/** Server-supplied image, already restricted to https/data by the parser. Never a host URL. */
export function SchemaFormThumbnail({ image, className }: { image?: SchemaFormImage; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (!image || failed) {
    return (
      <div className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}>
        <ImageIcon className="size-1/3 min-h-3 min-w-3" aria-hidden />
      </div>
    )
  }
  return (
    <img
      src={image.src}
      alt=""
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn('bg-muted object-cover', className)}
    />
  )
}
