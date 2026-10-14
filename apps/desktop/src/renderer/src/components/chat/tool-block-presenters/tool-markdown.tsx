import { MarkdownView } from '../../MarkdownPreview'

/** Markdown inside a tool card: body-sized text with tight block spacing. */
export function renderToolMarkdown(content: string) {
  return (
    <MarkdownView
      content={content}
      className="md-compact !p-0 !py-0 text-xs leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_pre]:my-1.5 [&_blockquote]:my-1 first:[&>*]:mt-0 last:[&>*]:mb-0"
    />
  )
}
