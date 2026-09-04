import type { ImageGenToolBlockPresenterProps } from './presenters/ImageGenToolBlock'
import { ImageGenToolBlockPresenter } from './presenters/ImageGenToolBlock'
import { MediaImageRefThumb } from './media-tool-params'

/** Desktop host adapter for the shared image-generation presenter. */
export function ImageGenToolBlock(props: ImageGenToolBlockPresenterProps) {
  return (
    <ImageGenToolBlockPresenter
      {...props}
      renderReferenceImage={(path, label) => (
        <MediaImageRefThumb key={path} path={path} label={label} />
      )}
    />
  )
}
