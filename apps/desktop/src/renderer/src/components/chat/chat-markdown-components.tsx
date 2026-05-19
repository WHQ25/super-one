import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { openFileTab } from '@/components/activity/activity-panel-api'
import { useChatStore } from '@/stores/chat'
import { useSourceControlStore } from '@/stores/source-control'
import { clickReleasedOnSelection, parseFileLinkTarget } from '@/lib/file-link'

export function InlineFileChip({ name, filePath, lineNumber }: { name: string; filePath: string; lineNumber?: number }) {
  const handleClick = (e: React.MouseEvent): void => {
    if (clickReleasedOnSelection(e.currentTarget)) return
    e.stopPropagation()
    const projectPath = useChatStore.getState().activeProject
    if (!projectPath) return
    const relative = filePath.startsWith(projectPath + '/') ? filePath.slice(projectPath.length + 1) : filePath
    useSourceControlStore.getState().selectFile(projectPath, relative, lineNumber)
    openFileTab(relative)
  }
  return (
    <span
      role="button"
      onClick={handleClick}
      title={filePath}
      className="inline-flex cursor-pointer items-center gap-0.5 rounded bg-muted px-1 text-[0.9em] text-foreground whitespace-nowrap align-baseline translate-y-[1px] hover:bg-muted/80 transition-colors"
    >
      <FileIcon name={name} size={12} />
      <span>{name}</span>
      {lineNumber != null && <span className="text-muted-foreground text-[0.85em]">#L{lineNumber}</span>}
    </span>
  )
}

function FileLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { href: rawHref, children, ...rest } = props
  const projectPath = useChatStore.getState().activeProject
  const href = rawHref ? decodeURIComponent(rawHref) : rawHref
  if (href && projectPath) {
    const { filePath, lineNumber } = parseFileLinkTarget(href)
    if (filePath.startsWith(projectPath + '/')) {
      const text = typeof children === 'string' ? children : (filePath.split('/').pop() || '')
      return <InlineFileChip name={text} filePath={filePath} lineNumber={lineNumber} />
    }
  }
  return <a href={rawHref} {...rest}>{children}</a>
}

export const fileLinkComponents = { a: FileLink }
