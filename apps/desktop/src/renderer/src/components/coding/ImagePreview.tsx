import { lazy, Suspense } from 'react'

interface ImagePreviewProps {
  src: string
  alt: string
}

const ImagePreviewImpl = lazy(() => import('./ImagePreviewImpl'))

export function ImagePreview(props: ImagePreviewProps) {
  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <ImagePreviewImpl {...props} />
    </Suspense>
  )
}
