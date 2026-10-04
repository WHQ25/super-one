import { useMemo, type ReactNode } from 'react'
import { ModUiProvider, type ModUiPorts } from '@superone/chat-view/mod-ui'
import { CopyableMarkdown } from '@/components/chat/CopyableMarkdown'
import { HighlightedCodeBlock } from '@/components/chat/CodeBlock'
import { codePlugin } from '@/components/chat/code-plugins'
import { FileLink } from '@/components/chat/chat-markdown-components'
import { requestOpenExternalLink } from '@/lib/external-link'
import { getModUiClient, useDrawModInterfaces } from './registry'

/** How desktop draws the parts of a mod tree each platform draws its own way. */
export const desktopModUiPorts: ModUiPorts = {
  renderMarkdown: (text) => <CopyableMarkdown text={text} isStreaming={false} />,
  renderCode: ({ source, language, path }) => (
    <HighlightedCodeBlock code={source} language={language ?? languageOf(path)} codePlugin={codePlugin} />
  ),
  openLink: requestOpenExternalLink,
  renderLink: (href, children) => <FileLink href={href} data-streamdown="link">{children}</FileLink>,
}

function languageOf(path: string | undefined): string {
  const ext = path?.split('.').pop()?.toLowerCase()
  return ext && ext !== path ? ext : 'text'
}

/**
 * Gives every mod site below the session's client. `sessionId` null (a
 * session not created yet), a harness that draws no mods or the preference
 * turned off renders children untouched.
 */
export function DesktopModUi({ projectPath, sessionId, enabled, children }: { projectPath: string | null; sessionId: string | null; enabled: boolean; children: ReactNode }) {
  const drawMods = useDrawModInterfaces()
  const client = useMemo(
    () => (drawMods && enabled && projectPath && sessionId ? getModUiClient(projectPath, sessionId) : null),
    [drawMods, enabled, projectPath, sessionId],
  )
  return <ModUiProvider client={client} ports={desktopModUiPorts}>{children}</ModUiProvider>
}
