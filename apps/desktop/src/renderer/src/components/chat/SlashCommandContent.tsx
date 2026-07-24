import { useMemo } from 'react'
import { Streamdown } from 'streamdown'
import { ContextCommandView } from './ContextCommandView'
import { ReleaseNotesView } from './ReleaseNotesView'
import {
  codePlugin,
  streamdownPlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
  streamdownRehypePlugins,
} from './chat-shared'
import { createStreamdownCodeComponent } from './CodeBlock'

const MARKDOWN_COMMANDS = new Set(['usage', 'cost', 'share', 'unshare'])

function MarkdownCommandView({ content }: { content: string }) {
  const codeComponent = useMemo(() => createStreamdownCodeComponent(codePlugin), [])
  const components = useMemo(
    () => ({ ...streamdownComponents, code: codeComponent }),
    [codeComponent],
  )
  return (
    <Streamdown
      className="chat-md text-xs"
      plugins={streamdownPlugins}
      rehypePlugins={streamdownRehypePlugins}
      components={components}
      controls={streamdownControls}
      linkSafety={streamdownLinkSafety}
    >
      {content}
    </Streamdown>
  )
}

export function SlashCommandContent({ command, content }: { command: string; content: string }) {
  if (MARKDOWN_COMMANDS.has(command)) {
    return <MarkdownCommandView content={content} />
  }
  switch (command) {
    case 'context':
      return <ContextCommandView content={content} />
    case 'release-notes':
      return <ReleaseNotesView content={content} />
    default:
      return (
        <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
          {content}
        </pre>
      )
  }
}
