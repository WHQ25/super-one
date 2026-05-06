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
      className={cn('rounded-[22%] object-contain', className)}
    />
  )
}
