import type { Meta, StoryObj } from '@storybook/react-vite'
import { MarkdownDocumentContent } from './MarkdownDocumentView'

const DOCUMENT = `---
title: MCP Apps gateway
status: accepted
---

# MCP Apps gateway

SuperOne is the MCP client of record for App servers. See [the bridge](../../apps/desktop/src/main/mcp-bridge.ts:42) and the [spec](https://modelcontextprotocol.io).

## Design

\`\`\`mermaid
sequenceDiagram
  participant H as Harness
  participant G as Gateway (SuperOne)
  participant M as App server
  H->>G: tools/call
  G->>M: tools/call
  M-->>G: full result
  G-->>H: same result
\`\`\`

| Surface | Renderer | Mermaid |
| --- | --- | :---: |
| Desktop editor | TipTap | ✓ |
| Phone preview | Streamdown | ✓ |

- [x] Routing per session
- [ ] stdio shim

The token budget is $$\\sum_{i=1}^{n} t_i \\le B$$ per call.

$$
E = mc^2
$$

\`\`\`ts
export function route(name: string): string {
  return \`gateway/\${name}\`
}
\`\`\`

> Servers without App use stay native.
`

/**
 * A Markdown file as the phone's file preview renders it: the transcript's
 * pipeline in the `markdown-document` view mode, with frontmatter shown as YAML
 * like the desktop editor. Relative links resolve against the file's folder.
 */
const meta = {
  title: 'Chat/SuperOne/Markdown document',
  component: MarkdownDocumentContent,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="w-[390px]"><Story /></div>],
  args: {
    document: { text: DOCUMENT, directory: '/Users/me/proj/docs/architecture' },
    scheme: 'dark' as const,
  },
  render: (args, context) => (
    <MarkdownDocumentContent {...args} scheme={context.globals.theme === 'light' ? 'light' : args.scheme} />
  ),
} satisfies Meta<typeof MarkdownDocumentContent>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Default · mermaid, math, table, code, frontmatter',
}

export const Light: Story = {
  name: 'Light scheme',
  args: { scheme: 'light' },
}

export const Empty: Story = {
  name: 'Empty file',
  args: { document: { text: '', directory: '/Users/me/proj' } },
}

export const LongContent: Story = {
  name: 'Long content · wide table and long lines',
  args: {
    document: {
      directory: '/Users/me/proj',
      text: [
        '# Release notes',
        ...Array.from({ length: 30 }, (_, i) => `- Item ${i + 1}: ${'a fairly long line of prose that wraps on a phone '.repeat(2)}`),
        '',
        `| ${Array.from({ length: 8 }, (_, i) => `Column ${i + 1}`).join(' | ')} |`,
        `| ${Array.from({ length: 8 }, () => '---').join(' | ')} |`,
        `| ${Array.from({ length: 8 }, (_, i) => `value-${i + 1}-with-no-breaks`).join(' | ')} |`,
      ].join('\n'),
    },
  },
}
