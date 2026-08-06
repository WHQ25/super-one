import { cn } from '@superone/ui/lib/utils'
import { useMiniAppStore } from '@/stores/miniapp'
import defaultIcon from '@/assets/default-app-icon.svg'

interface MiniAppIconProps {
  appId: string
  className?: string
}

export function MiniAppIcon({ appId, className }: MiniAppIconProps) {
  const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
  const isDev = app?.manifest.isDev
  const logo = app?.manifest.logo
  const rev = useMiniAppStore((s) => isDev ? s._iconRev : 0)
  const src = logo ? `superone-app://${appId}/${logo}${isDev ? `?v=${rev}` : ''}` : defaultIcon
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn(
        // block: avoid replaced-element baseline gap that drops the chip below text.
        'block rounded-[22%] object-contain',
        className,
      )}
    />
  )
}
