import type { IDockviewPanelHeaderProps } from 'dockview-core'
import { DockviewDefaultTab } from 'dockview'
import { FileIcon } from '@/components/ui/FileIcon'

export function FilePreviewTab(props: IDockviewPanelHeaderProps<{ filePath: string }>) {
  const fileName = props.params.filePath.split('/').pop() ?? ''

  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      {fileName && <FileIcon name={fileName} size={14} className="shrink-0" />}
      <span className="truncate text-xs">{fileName || 'File'}</span>
      <button
        onClick={(e) => { e.stopPropagation(); props.api.close() }}
        className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 [div:hover>&]:opacity-100"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>
    </div>
  )
}

export function DefaultActivityTab(props: IDockviewPanelHeaderProps) {
  return <DockviewDefaultTab {...props} hideClose={false} />
}

export const activityTabComponents: Record<string, React.FunctionComponent<IDockviewPanelHeaderProps>> = {
  'file-preview-tab': FilePreviewTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'default-tab': DefaultActivityTab,
}
