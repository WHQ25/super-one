import { cn } from '@superone/ui/lib/utils'
import { DefaultMiniAppIcon } from '@superone/ui/components/ui/DefaultMiniAppIcon'
import { useMiniAppStore } from '@/stores/miniapp'

interface MiniAppIconProps {
  appId: string
  className?: string
}

export function MiniAppIcon({ appId, className }: MiniAppIconProps) {
  const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
  const isDev = app?.manifest.isDev
  const logo = app?.manifest.logo
  const rev = useMiniAppStore((s) => isDev ? s._iconRev : 0)
  const classes = cn('block rounded-[22%] object-contain', className)
  if (!logo) return <DefaultMiniAppIcon className={classes} />
  const src = `superone-app://${appId}/${logo}${isDev ? `?v=${rev}` : ''}`
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      // block: avoid replaced-element baseline gap that drops the chip below text.
      className={classes}
    />
  )
}
