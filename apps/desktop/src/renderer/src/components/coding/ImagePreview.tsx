import { lazy, Suspense } from 'react'

interface ImagePreviewProps {
  src: string
  alt: string
  /** Leave ← → to a surrounding viewer that navigates between items with them. */
  disableArrowKeys?: boolean
}

const ImagePreviewImpl = lazy(() => import('./ImagePreviewImpl'))

export function ImagePreview(props: ImagePreviewProps) {
  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <ImagePreviewImpl {...props} />
    </Suspense>
  )
}
