import { cn } from '@/lib/utils'
import { useMiniAppStore } from '@/stores/miniapp'
import defaultIcon from '@/assets/default-app-icon.svg'

interface MiniAppIconProps {
  appId: string
  className?: string
}

export function MiniAppIcon({ appId, className }: MiniAppIconProps) {
  const logo = useMiniAppStore((s) => s.apps.find((a) => a.id === appId)?.manifest.logo)
  const src = logo ? `superone-app://${appId}/${logo}` : defaultIcon
  return (
    <img
      src={src}
      alt=""
      className={cn('rounded-[22%] object-contain', className)}
    />
  )
}
