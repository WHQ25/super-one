import { useState } from 'react'
import { MousePointer2 } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useAppIcon } from '@/hooks/use-app-icon'

/** macOS app icon for a bundle id; falls back to Computer Use glyph. */
export function DesktopAppIcon({
  bundleId,
  className,
}: {
  bundleId: string
  className?: string
}) {
  const uri = useAppIcon(bundleId)
  const [broken, setBroken] = useState(false)

  if (uri && !broken) {
    return (
      <img
        src={uri}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        className={cn(
          'block shrink-0 rounded-[22%] object-contain',
          // Explicit box so a failed/blank glyph cannot collapse the row.
          className,
        )}
      />
    )
  }
  return (
    <MousePointer2
      className={cn('shrink-0 text-emerald-600 dark:text-emerald-400', className)}
    />
  )
}
