const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/

export interface ParsedMarkdown {
  frontmatter: string | null
  body: string
}

/** A leading `---` YAML block, split from the body. A mid-document `---` is a rule, not frontmatter. */
export function splitFrontmatter(source: string): ParsedMarkdown {
  const m = source.match(FRONTMATTER_RE)
  if (!m) return { frontmatter: null, body: source }
  return { frontmatter: m[1], body: m[2] }
}

/**
 * The document with its frontmatter shown as a YAML code block, the way the
 * desktop's Markdown editor presents it. Rendered as plain Markdown instead,
 * `title: x` above the closing `---` would read as a setext heading.
 */
export function frontmatterAsCodeBlock(source: string): string {
  const { frontmatter, body } = splitFrontmatter(source)
  if (frontmatter === null) return source
  const longestRun = Math.max(2, ...(frontmatter.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longestRun + 1)
  return `${fence}yaml\n${frontmatter}\n${fence}\n\n${body}`
}
