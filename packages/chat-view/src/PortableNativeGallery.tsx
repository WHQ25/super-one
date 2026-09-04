import type { NativeWidgetPayload } from '@superone/shared/generative-ui/native-widgets'
import { ExternalLink, ImageIcon, Video } from 'lucide-react'
import { requestNative } from './bridge'
import { portableFileName } from './portable-native-widget'

export function PortableNativeGallery(props: {
  payload: NativeWidgetPayload
  toolUseId?: string
}) {
  const { payload } = props
  const items = payload.nativeType === 'image-gallery' ? payload.images ?? [] : payload.videos ?? []
  const kind = payload.nativeType === 'image-gallery' ? 'image' : 'video'
  return (
    <section
      className="my-2 rounded-lg border border-border/60 bg-muted/20 p-2.5"
      data-native-widget={payload.nativeType}
      data-tool-use-id={props.toolUseId}
    >
      <div className="mb-2 flex items-center gap-2">
        {kind === 'image'
          ? <ImageIcon className="size-4 text-muted-foreground" />
          : <Video className="size-4 text-muted-foreground" />}
        <span className="font-medium text-foreground">{payload.title || `Generated ${kind}s`}</span>
        <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const path = item.savedPath!
          return (
            <button
              key={item.id || path}
              type="button"
              className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-md border border-border/50 bg-background/60 p-2 text-center"
              onClick={() => requestNative('previewFile', { path })}
            >
              {kind === 'image'
                ? <ImageIcon className="size-6 text-primary" />
                : <Video className="size-6 text-primary" />}
              <span className="max-w-full truncate text-xs text-foreground">{portableFileName(path)}</span>
              <span className="flex items-center gap-1 text-[11px] text-primary">
                Open {kind} <ExternalLink className="size-3" />
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
