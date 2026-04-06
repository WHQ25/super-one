import { Blocks } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMiniAppStore } from '@/stores/miniapp'

interface MiniAppIconProps {
  appId: string
  className?: string
}

export function MiniAppIcon({ appId, className }: MiniAppIconProps) {
  const logo = useMiniAppStore((s) => s.apps.find((a) => a.id === appId)?.manifest.logo)
  if (!logo) return <Blocks className={className} />
  return (
    <img
      src={`superone-app://${appId}/${logo}`}
      alt=""
      className={cn('rounded-[22%] object-contain', className)}
    />
  )
}
