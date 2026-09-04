import { expect, test, type Page } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import {
  AGENT_TOOL_RECORDINGS,
  BROWSER_TOOL_RECORDING,
  CODEX_COLLAB_RECORDING,
  IMAGE_GENERATION_RECORDING,
  INTERACTIVE_TOOL_RECORDING,
  PLAN_RECORDINGS,
  VIDEO_GENERATION_RECORDING,
  WORKFLOW_TOOL_RECORDING,
} from './fixtures/tool-family-recordings'

const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href

function message(id: string, content: ContentBlock[], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content,
    createdAt: '2026-09-04T00:00:00.000Z',
    providerId: 'claude',
    ...overrides,
  }
}

function textMessage(id: string, text = id, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message(id, [{ type: 'text', text }], overrides)
}

function tallMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => (
    textMessage(`turn-${index}`, `Turn ${index}\n\n${'content '.repeat(24)}`)
  ))
}

function stressMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const content = index % 20 === 0
      ? `Stress ${index}\n\n\`\`\`mermaid\ngraph LR\nS${index}-->E${index}\n\`\`\``
      : `Stress ${index}\n\n\`\`\`ts\nconst turn${index} = ${index}\n\`\`\``
    return textMessage(`stress-${index}`, content)
  })
}

async function openChat(page: Page): Promise<void> {
  await page.context().setOffline(true)
  await page.addInitScript(() => {
    const target = globalThis as typeof globalThis & {
      __hostMessages: unknown[]
      ReactNativeWebView: { postMessage(message: string): void }
    }
    target.__hostMessages = []
    target.ReactNativeWebView = {
      postMessage(raw: string) {
        target.__hostMessages.push(JSON.parse(raw))
      },
    }
  })
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
}

async function send(page: Page, envelope: unknown): Promise<void> {
  await page.evaluate((value) => {
    const target = globalThis as typeof globalThis & { __applyHost?: (message: unknown) => void }
    target.__applyHost?.(value)
  }, envelope)
}

test.beforeEach(async ({ page }) => openChat(page))

test('01 posts ready to the native host', async ({ page }) => {
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & { __hostMessages: Array<{ type?: string }> }
  ).__hostMessages.some((item) => item.type === 'ready'))).toBe(true)
})

test('02 hydrates from an object envelope', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [textMessage('hello', 'Hello WebView')] })
  await expect(page.getByText('Hello WebView')).toBeVisible()
})

test('03 accepts a string postMessage envelope', async ({ page }) => {
  await page.evaluate((payload) => globalThis.postMessage(JSON.stringify(payload), '*'), {
    type: 'hydrate', messages: [textMessage('string', 'String transport')],
  })
  await expect(page.getByText('String transport')).toBeVisible()
})

test('04 stamps the brand hue before hydration', async ({ page }) => {
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--brand-hue'))).toBe('250')
})

test('05 applies a host brand hue', async ({ page }) => {
  await send(page, { type: 'setTheme', hue: 188 })
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--brand-hue'))).toBe('188')
})

test('06 switches between dark and light schemes', async ({ page }) => {
  await send(page, { type: 'setTheme', scheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe('light')
})

test('07 applies safe-area viewport values', async ({ page }) => {
  await send(page, { type: 'setViewport', safeArea: { top: 12, right: 4, bottom: 30, left: 5 } })
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--safe-area-bottom'))).toBe('30px')
})

test('08 clamps the host font scale', async ({ page }) => {
  await send(page, { type: 'setViewport', fontScale: 4 })
  await expect.poll(() => page.evaluate(() => document.documentElement.style.fontSize)).toBe('25.6px')
})

test('09 applies the host locale', async ({ page }) => {
  await send(page, { type: 'setViewport', locale: 'zh' })
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
})

test('10 mounts only the latest 24 turns on hydrate', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: tallMessages(60) })
  await expect(page.locator('main')).toHaveAttribute('data-mounted-turns', '24')
})

test('11 excludes old turns from the initial DOM', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: tallMessages(60) })
  await expect(page.locator('[data-turn-id="turn-0"]')).toHaveCount(0)
  await expect(page.locator('[data-turn-id="turn-59"]')).toHaveCount(1)
})

test('12 loads eight older turns', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: tallMessages(60) })
  await page.getByRole('button', { name: 'Load earlier' }).click()
  await expect(page.locator('main')).toHaveAttribute('data-mounted-turns', '32')
})

test('13 caps a host window at 40 turns', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: tallMessages(80) })
  await send(page, { type: 'setWindow', range: { start: 0, end: 80 } })
  await expect(page.locator('main')).toHaveAttribute('data-mounted-turns', '40')
  await expect(page.locator('main')).toHaveAttribute('data-window-start', '40')
})

test('14 clamps an invalid host window', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: tallMessages(12) })
  await send(page, { type: 'setWindow', range: { start: -10, end: 500 } })
  await expect(page.locator('main')).toHaveAttribute('data-window-start', '0')
  await expect(page.locator('main')).toHaveAttribute('data-window-end', '12')
})

test('15 resets the transcript', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [textMessage('reset-me')] })
  await send(page, { type: 'reset' })
  await expect(page.getByText('Waiting for session…')).toBeVisible()
})

test('16 renders degraded connection state', async ({ page }) => {
  await send(page, { type: 'setConnection', state: 'reconnecting', epoch: 2 })
  await expect(page.getByText('reconnecting')).toBeVisible()
})

test('17 renders reduced todo state', async ({ page }) => {
  await send(page, {
    type: 'hydrate',
    todos: [{ id: 'todo-1', subject: 'Ship migration', description: '', status: 'in_progress' }],
  })
  await expect(page.getByTestId('todo-list')).toContainText('Ship migration')
})

test('18 renders markdown structure', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [textMessage('md', '# Heading\n\n**bold**\n\n- one')] })
  await expect(page.getByRole('heading', { name: 'Heading' })).toBeVisible()
  await expect(page.locator('.chat-md')).toContainText('bold')
  await expect(page.locator('li')).toContainText('one')
})

test('19 renders fenced code without external assets', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [textMessage('code', '```ts\nconst answer = 42\n```')] })
  await expect(page.locator('[data-chat-codeblock]')).toContainText('const answer = 42')
})

test('20 renders Mermaid diagrams', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [textMessage('mermaid', '```mermaid\ngraph TD\nA-->B\n```')] })
  await expect(page.locator('[data-chat-codeblock] svg[id^="mermaid-"]')).toBeVisible({ timeout: 12_000 })
})

test('21 renders LaTeX with KaTeX', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [textMessage('math', '$$x^2 + y^2 = z^2$$')] })
  await expect(page.locator('.katex')).toBeVisible()
})

test('22 marks a streaming turn', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [textMessage('live', 'typing', { status: 'streaming' })] })
  await expect(page.locator('[data-turn-id="live"]')).toHaveAttribute('data-message-status', 'streaming')
  await expect(page.getByText('Working…')).toBeVisible()
})

test('23 expands a tool result', async ({ page }) => {
  await send(page, {
    type: 'hydrate',
    messages: [message('tool', [
      { type: 'tool_use', toolName: 'Read', toolUseId: 'tool-1', input: '{"file_path":"README.md"}', status: 'complete' },
      { type: 'tool_result', toolUseId: 'tool-1', summary: 'file body' },
    ])],
  })
  await page.locator('[data-tool-use-id="tool-1"] > button').click()
  await expect(page.locator('[data-tool-use-id="tool-1"]')).toContainText('file body')
})

test('24 shows pending permission on the matching tool', async ({ page }) => {
  await send(page, {
    type: 'hydrate',
    pendingPermission: { requestId: 'permission-1', toolName: 'Bash', toolUseId: 'tool-2' },
    messages: [message('permission', [
      { type: 'tool_use', toolName: 'Bash', toolUseId: 'tool-2', input: '{"command":"pwd"}', status: 'streaming' },
    ], { status: 'streaming' })],
  })
  await expect(page.locator('[data-tool-use-id="tool-2"]')).toHaveAttribute('data-permission-pending', 'true')
  await expect(page.locator('[data-tool-use-id="tool-2"]')).toContainText('Awaiting approval')
})

test('25 routes links through requestNative', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [textMessage('link', '[Open](https://example.com/path)')] })
  await page.getByRole('link', { name: 'Open' }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & { __hostMessages: Array<{ type?: string; action?: string }> }
  ).__hostMessages.some((item) => item.type === 'requestNative' && item.action === 'openLink'))).toBe(true)
})

test('26 scrolls to a turn outside the current window', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: tallMessages(60) })
  await send(page, { type: 'scrollToTurn', turnId: 'turn-4', behavior: 'auto' })
  await expect(page.locator('[data-turn-id="turn-4"]')).toHaveCount(1)
  await expect(page.locator('main')).toHaveAttribute('data-mounted-turns', '24')
})

test('27 keeps a mixed 200-turn transcript inside the initial render window', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: stressMessages(200) })

  await expect(page.locator('main')).toHaveAttribute('data-mounted-turns', '24')
  await expect(page.locator('[data-turn-id="stress-0"]')).toHaveCount(0)
  await expect(page.locator('[data-turn-id="stress-199"]')).toContainText('const turn199 = 199')
  await expect(page.locator('[data-turn-id="stress-180"] svg[id^="mermaid-"]')).toBeVisible({ timeout: 12_000 })
})

test('28 opens a remotely stripped file tool from derived metadata', async ({ page }) => {
  await send(page, {
    type: 'hydrate',
    messages: [message('remote-read', [{
      type: 'read',
      toolName: 'Read',
      toolUseId: 'remote-read-tool',
      input: '',
      toolSummary: 'App.tsx (L20–40)',
      toolFilePath: 'apps/mobile/App.tsx',
      status: 'complete',
    }])],
  })

  await page.locator('[data-tool-use-id="remote-read-tool"] > button').click()
  await page.getByRole('button', { name: 'Open in host' }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __hostMessages: Array<{ type?: string; action?: string; payload?: { path?: string } }>
    }
  ).__hostMessages.some((item) => (
    item.type === 'requestNative'
      && item.action === 'openFile'
      && item.payload?.path === 'apps/mobile/App.tsx'
  )))).toBe(true)

})

test('29 renders native widget media as a host-backed gallery', async ({ page }) => {
  const result = JSON.stringify({
    kind: 'native',
    nativeType: 'image-gallery',
    title: 'Generated concepts',
    images: [{
      id: 'generated-1',
      type: 'image_generation',
      status: 'completed',
      savedPath: '/project/output/concept.png',
    }],
  })
  await send(page, {
    type: 'hydrate',
    messages: [message('native-widget', [
      {
        type: 'tool_use',
        toolName: 'mcp__superone__widget_show',
        toolUseId: 'native-widget-tool',
        input: '',
        status: 'complete',
      },
      { type: 'tool_result', toolUseId: 'native-widget-tool', summary: result },
    ])],
  })

  await expect(page.locator('[data-native-widget="image-gallery"]')).toContainText('Generated concepts')
  await page.getByRole('button', { name: /Open image/ }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __hostMessages: Array<{ type?: string; action?: string; payload?: { path?: string } }>
    }
  ).__hostMessages.some((item) => (
    item.type === 'requestNative'
      && item.action === 'previewFile'
      && item.payload?.path === '/project/output/concept.png'
  )))).toBe(true)
})

test('30 uses the shared Claude tool-group presenter', async ({ page }) => {
  await send(page, {
    type: 'hydrate',
    messages: [message('tool-group', [
      { type: 'tool_use', toolName: 'Read', toolUseId: 'read-1', input: '{"file_path":"one.ts"}', status: 'complete' },
      { type: 'tool_result', toolUseId: 'read-1', summary: 'one' },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'read-2', input: '{"file_path":"two.ts"}', status: 'complete' },
      { type: 'tool_result', toolUseId: 'read-2', summary: 'two' },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'read-3', input: '{"file_path":"three.ts"}', status: 'complete' },
      { type: 'tool_result', toolUseId: 'read-3', summary: 'three' },
      { type: 'text', text: 'Done.' },
    ])],
  })

  const group = page.locator('.tool-group')
  await expect(group).toContainText('Read 3 files')
  await group.locator('> button').click()
  await expect(page.locator('[data-tool-use-id="read-1"]')).toBeVisible()
})

test('31 uses the shared Codex command-group presenter', async ({ page }) => {
  await send(page, {
    type: 'hydrate',
    messages: [message('codex-group', [], {
      providerId: 'codex',
      metadata: {
        codex: {
          threadId: 'thread-1',
          usage: null,
          items: [
            {
              id: 'command-1',
              type: 'command_execution',
              command: 'sed -n 1,20p one.ts',
              aggregatedOutput: 'one',
              status: 'completed',
              commandActions: [{ type: 'read', path: 'one.ts' }],
            },
            {
              id: 'command-2',
              type: 'command_execution',
              command: 'sed -n 1,20p two.ts',
              aggregatedOutput: 'two',
              status: 'completed',
              commandActions: [{ type: 'read', path: 'two.ts' }],
            },
            { id: 'answer', type: 'agent_message', text: 'Reviewed both files.' },
          ],
        },
      },
    })],
  })

  await expect(page.locator('.tool-group')).toContainText(/2/)
  await expect(page.getByText('Reviewed both files.')).toBeVisible()
})

test('32 renders a Codex collaboration recording with the shared presenter', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [CODEX_COLLAB_RECORDING] })

  const card = page.locator('.subagent-container')
  await expect(card).toContainText('Reviewer')
  await expect(card).toContainText('UI review')
  await card.locator('> button').click()
  await expect(card.locator('[data-tool-use-id="child-read"]')).toContainText('ToolRow.tsx')
  await expect(card.locator('[data-tool-use-id="child-search"]')).toContainText('mobile tool row accessibility')
})

test('33 renders Claude and Codex plan recordings with shared presenters', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: PLAN_RECORDINGS })

  await expect(page.getByText('Entered Plan Mode')).toBeVisible()
  await expect(page.getByText('Plan Approved')).toBeVisible()
  const plan = page.locator('[data-turn-id="recording-codex-plan"]')
  await expect(plan).toContainText('Migration plan')
  await plan.getByText('Plan', { exact: true }).click()
  await expect(plan).toContainText('Share presenters')
})

test('34 renders an image-generation recording with the shared presenter', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [IMAGE_GENERATION_RECORDING] })

  const turn = page.locator('[data-turn-id="recording-image-generation"]')
  await expect(turn).toContainText('A compact mobile chat interface')
  await turn.locator('.tool-node > div').first().click()
  await expect(turn).toContainText('Generation quota reached')
  await turn.getByRole('button', { name: 'Preview Reference 1' }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __hostMessages: Array<{ type?: string; action?: string; payload?: { path?: string } }>
    }
  ).__hostMessages.some((item) => (
    item.type === 'requestNative'
      && item.action === 'previewFile'
      && item.payload?.path === '/project/reference.png'
  )))).toBe(true)
})

test('35 renders a video-generation recording with the shared presenter', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [VIDEO_GENERATION_RECORDING] })

  const turn = page.locator('[data-turn-id="recording-video-generation"]')
  await expect(turn).toContainText('Animate the mobile chat transition')
  await turn.locator('.tool-node > div').first().click()
  await expect(turn).toContainText('5s')
  await turn.getByRole('button', { name: 'Preview First frame' }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __hostMessages: Array<{ type?: string; action?: string; payload?: { path?: string } }>
    }
  ).__hostMessages.some((item) => (
    item.type === 'requestNative'
      && item.action === 'previewFile'
      && item.payload?.path === '/project/first-frame.png'
  )))).toBe(true)
})

test('36 renders Browser, page-tool, and download recordings with shared presenters', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [BROWSER_TOOL_RECORDING] })

  const turn = page.locator('[data-turn-id="recording-browser-tools"]')
  await turn.getByRole('button', { name: /Detail/ }).click()
  const rows = turn.locator('.tool-node')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0)).toContainText('Screenshot')
  await rows.nth(0).locator('> div').first().click()
  await turn.getByRole('button', { name: 'Preview Screenshot' }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __hostMessages: Array<{ type?: string; action?: string; payload?: { path?: string } }>
    }
  ).__hostMessages.some((item) => (
    item.type === 'requestNative'
      && item.action === 'previewFile'
      && item.payload?.path === '/project/browser-checkout.png'
  )))).toBe(true)

  await expect(rows.nth(1)).toContainText('Listed 1 Tool')
  await rows.nth(1).locator('> div').first().click()
  await expect(turn).toContainText('Adds the selected product to the cart.')
  await expect(rows.nth(2)).toContainText('Add to Cart')
  await expect(rows.nth(2)).toContainText('Add the black shirt to the cart')

  await rows.nth(3).locator('> div').first().click()
  await turn.getByRole('button', { name: 'Preview receipt.pdf' }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __hostMessages: Array<{ type?: string; action?: string; payload?: { path?: string } }>
    }
  ).__hostMessages.some((item) => (
    item.type === 'requestNative'
      && item.action === 'previewFile'
      && item.payload?.path === '/project/receipt.pdf'
  )))).toBe(true)
})

test('37 renders Device and Computer Use recordings with shared presenters', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [INTERACTIVE_TOOL_RECORDING] })

  const turn = page.locator('[data-turn-id="recording-interactive-tools"]')
  await turn.getByRole('button', { name: /Detail/ }).click()
  const rows = turn.locator('.tool-node')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0)).toContainText('Inspect checkout on phone')
  await rows.nth(0).locator('> div').first().click()
  await rows.nth(0).getByRole('button', { name: 'Preview Device Screenshot' }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __hostMessages: Array<{ type?: string; action?: string; payload?: { path?: string } }>
    }
  ).__hostMessages.some((item) => (
    item.type === 'requestNative'
      && item.action === 'previewFile'
      && item.payload?.path === '/project/device-checkout.png'
  )))).toBe(true)

  await rows.nth(1).locator('> div').first().click()
  await expect(rows.nth(1)).toContainText('Button did not respond')

  await expect(rows.nth(2)).toContainText('Inspect desktop checkout')
  await rows.nth(2).locator('> div').first().click()
  await rows.nth(2).getByRole('button', { name: 'Preview Desktop Screenshot' }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __hostMessages: Array<{ type?: string; action?: string; payload?: { path?: string } }>
    }
  ).__hostMessages.some((item) => (
    item.type === 'requestNative'
      && item.action === 'previewFile'
      && item.payload?.path === '/project/computer-checkout.png'
  )))).toBe(true)
})

test('38 renders agent roster and review findings with shared presenters', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: AGENT_TOOL_RECORDINGS })

  const roster = page.locator('[data-turn-id="recording-list-agents"]')
  await expect(roster).toContainText('1 subagent')
  await roster.locator('.tool-node > div').first().click()
  await expect(roster).toContainText('reviewer-a')
  await expect(roster).toContainText('mobile-shell')

  const findings = page.locator('[data-turn-id="recording-report-findings"]')
  await expect(findings).toContainText('Portable route drops the tool result')
  await findings.getByRole('button', { name: 'Open packages/chat-view/src/PortableTurnAdapters.tsx' }).click()
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & {
      __hostMessages: Array<{ type?: string; action?: string; payload?: { path?: string } }>
    }
  ).__hostMessages.some((item) => (
    item.type === 'requestNative'
      && item.action === 'openFile'
      && item.payload?.path === 'packages/chat-view/src/PortableTurnAdapters.tsx'
  )))).toBe(true)

  const collab = page.locator('[data-turn-id="recording-session-collab"]')
  await expect(collab).toContainText('Reviewer session')
  await collab.locator('.tool-node > div').first().click()
  await expect(collab.getByText('Review complete.')).toBeVisible()
})

test('39 renders automation, config, and media-provider recordings with shared presenters', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [WORKFLOW_TOOL_RECORDING] })

  const turn = page.locator('[data-turn-id="recording-workflow-tools"]')
  await turn.getByRole('button', { name: /Detail/ }).click()
  const rows = turn.locator('.tool-node')
  await expect(rows).toHaveCount(3)

  await expect(rows.nth(0)).toContainText('Daily review')
  await rows.nth(0).locator('> div').first().click()
  await expect(rows.nth(0)).toContainText('Every weekday at 09:00')

  await expect(rows.nth(1)).toContainText('Chat settings')
  await rows.nth(1).locator('> div').first().click()
  await expect(rows.nth(1)).toContainText('Detail chat mode')
  await expect(rows.nth(1)).toContainText('off')
  await expect(rows.nth(1)).toContainText('on')

  await expect(rows.nth(2)).toContainText('1 matched')
  await rows.nth(2).locator('> div').first().click()
  await expect(rows.nth(2)).toContainText('OpenAI')
  await expect(rows.nth(2)).toContainText('GPT Image 1')
})
