import type { FilePreviewState } from '../file-preview-state'

const CODE = `import { useMemo } from 'react'
import { FileChipShell } from './presenters/FileChipShell'

/**
 * File name chip that hands the path to the native host instead of opening a
 * desktop tab. Only the tap target differs between the two surfaces.
 */
export function PortableFileChip({ name, filePath }: { name: string; filePath: string }) {
  const icon = useMemo(() => filePath.split(/[/\\\\]/).pop() || name, [filePath, name])
  return (
    <FileChipShell
      icon={icon}
      name={name}
      title={filePath}
      onClick={(event) => { event.stopPropagation(); requestNative('previewFile', { path: filePath }) }}
    />
  )
}

const VERY_LONG_LINE = 'const configuration = { retries: 3, backoffMs: [250, 500, 1000, 2000, 4000], endpoints: ["https://relay.example.com/v1", "https://relay-fallback.example.com/v1"], headers: { "x-client": "superone-mobile" } }'
`

const MARKDOWN = `# Remote file preview

A chip in the transcript opens the file **in place**, the way the desktop opens a tab.

## What arrives inline

- Text and code under 256 KiB
- Markdown, rendered as prose
- The cited line, when the chip carried one

\`\`\`ts
const inline = size <= INLINE_PREVIEW_MAX_BYTES
\`\`\`

> Anything else becomes a transfer card. Over the relay the user confirms it first.
`

const PATH = '/workspace/super-one/packages/chat-view/src/PortableToolRow.tsx'

/** Every state the preview page can reach, keyed by the label the gallery shows. */
export const FILE_PREVIEW_FIXTURES: ReadonlyArray<{ label: string; state: FilePreviewState }> = [
  { label: 'Code · cited line 16', state: { kind: 'text', path: PATH, name: 'PortableToolRow.tsx', text: CODE, size: CODE.length, markdown: false, line: 16 } },
  { label: 'Code · no anchor', state: { kind: 'text', path: PATH, name: 'PortableToolRow.tsx', text: CODE, size: CODE.length, markdown: false } },
  { label: 'Markdown', state: { kind: 'text', path: '/workspace/super-one/docs/preview.md', name: 'preview.md', text: MARKDOWN, size: MARKDOWN.length, markdown: true } },
  { label: 'Empty file', state: { kind: 'text', path: '/workspace/super-one/.gitkeep', name: '.gitkeep', text: '', size: 0, markdown: false } },
  { label: 'Loading', state: { kind: 'loading', path: PATH, name: 'PortableToolRow.tsx', line: 16 } },
  { label: 'Transfer · relay, awaiting confirm', state: { kind: 'transfer', path: '/workspace/super-one/art/hero.png', name: 'hero.png', size: 4_820_113, mimeType: 'image/png', needsConfirm: true, started: false } },
  { label: 'Transfer · relay, started', state: { kind: 'transfer', path: '/workspace/super-one/art/hero.png', name: 'hero.png', size: 4_820_113, mimeType: 'image/png', needsConfirm: true, started: true } },
  { label: 'Transfer · LAN, auto-started', state: { kind: 'transfer', path: '/workspace/super-one/logs/dev.log', name: 'dev.log', size: 1_204_988, mimeType: 'application/octet-stream', needsConfirm: false, started: true } },
  { label: 'Error', state: { kind: 'error', path: '/workspace/super-one/.env', name: '.env', message: 'path matches blacklist' } },
]
