import { cn } from '@superone/ui/lib/utils'
import { Z_CLASS } from '@/lib/z-layers'
import { ComputerUsePictureInPicture } from './ComputerUsePictureInPicture'

export function ComputerUseHostLayer() {
  return (
    <div
      data-computer-use-host-layer=""
      className={cn('pointer-events-none fixed inset-0', Z_CLASS.HOST_COMPUTER_USE)}
    >
      <ComputerUsePictureInPicture />
    </div>
  )
}
