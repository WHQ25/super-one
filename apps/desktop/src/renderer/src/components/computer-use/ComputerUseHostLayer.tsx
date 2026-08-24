import { ComputerUsePictureInPicture } from './ComputerUsePictureInPicture'

export function ComputerUseHostLayer() {
  return (
    <div
      data-computer-use-host-layer=""
      className="pointer-events-none fixed inset-0 z-30"
    >
      <ComputerUsePictureInPicture />
    </div>
  )
}
