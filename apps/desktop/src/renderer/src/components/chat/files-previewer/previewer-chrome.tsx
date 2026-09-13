import { cn } from '@superone/ui/lib/utils'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { FileChip } from '@/components/chat/FileChip'

/**
 * The header's file chip. It is the ordinary chat `FileChip` — same click into the
 * activity panel, same context menu, same drag — showing the path the agent wrote,
 * truncated from the left so the basename stays readable.
 */
export function PreviewerFileChip({ file, className }: { file: PreviewerFile; className?: string }) {
  return (
    <span className={cn('flex min-w-0', className)} data-previewer-control>
      <FileChip
        name={file.path}
        title={file.absolutePath}
        filePath={file.absolutePath}
        className="max-w-full font-mono text-xs [direction:rtl] [text-align:left]"
      />
    </span>
  )
}

/** Position dots shared by the card and the fullscreen footer; clickable. */
export function PreviewerDots({ count, index, onSelect }: { count: number; index: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-1.5" data-testid="previewer-dots">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i + 1}`}
          aria-current={i === index}
          onClick={() => onSelect(i)}
          data-previewer-control
          className={cn(
            'h-1.5 rounded-full transition-all',
            i === index ? 'w-4 bg-foreground' : 'w-1.5 bg-border hover:bg-muted-foreground',
          )}
        />
      ))}
    </div>
  )
}
