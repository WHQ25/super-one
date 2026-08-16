import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { useLayoutEffect } from 'react'
import { ToolBlock } from './ToolBlock'
import type { BrowserOp } from './browser-tool-display'
import {
  createDefaultPerSessionState,
  createDefaultProjectState,
  useChatStore,
} from '@/stores/chat'

const SB_PROJECT = '__storybook__'
const SB_SESSION = 'sb'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container space-y-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function mcp(op: BrowserOp): string {
  return `mcp__superone__browser_${op}`
}

function tool(
  op: BrowserOp,
  opts: {
    input?: Record<string, unknown>
    result?: string
    status?: 'streaming' | 'complete'
    elapsedSeconds?: number
    isError?: boolean
  } = {},
) {
  return (
    <ToolBlock
      toolName={mcp(op)}
      input={JSON.stringify(opts.input ?? {})}
      status={opts.status ?? 'complete'}
      result={opts.result}
      elapsedSeconds={opts.elapsedSeconds}
      isError={opts.isError}
    />
  )
}

function seedBrowserDownload(
  taskId: string,
  entry: {
    status: 'progressing' | 'completed' | 'failed'
    path?: string
    filename?: string
    bytes?: number
    totalBytes?: number
    mimeType?: string
    url?: string
    error?: string
  },
): void {
  const session = createDefaultPerSessionState()
  session.browserDownloads = { [taskId]: entry }
  const project = createDefaultProjectState()
  project._activeSessionId = SB_SESSION
  project._sessions = { [SB_SESSION]: session }
  useChatStore.setState({
    activeProject: SB_PROJECT,
    projectSessions: { [SB_PROJECT]: project },
  })
}

const TOON_SNAPSHOT = `url: https://example.com/checkout
title: Checkout
loading: false
elements[3]{selector,role,name}:
  button.submit,button,Pay now
  a.cart,link,Cart
  input#email,textbox,Email
console[1]{level,text}:
  warning,Mixed content`

const TOON_QUERY = `matches[2]{selector,role,name}:
  button.primary,button,Continue
  button.ghost,button,Back
total: 2`

const TOON_TABS = `tabs[2]{tab,url,title}:
  t1,https://example.com/,Home
  t2,https://example.com/cart,Cart
count: 2`

const TOON_NETWORK_STOP = `count: 3
requests[3]{requestId,method,status,url,bodyBytes}:
  r1,GET,200,https://api.example.com/me,128
  r2,POST,201,https://api.example.com/orders,2048
  r3,GET,304,https://cdn.example.com/app.js,0`

const TOON_NETWORK_WAIT = `requestId: r2
method: POST
status: 201
url: https://api.example.com/orders
bodyBytes: 2048`

const TOON_NETWORK_BODY = `url: https://api.example.com/orders
method: POST
status: 201
mimeType: application/json
body: {"id":"ord_1","total":42}`

const TOON_COOKIES = `cookies[2]{name,value,domain}:
  session,abc123,.example.com
  theme,dark,.example.com`

const meta: Meta = {
  title: 'SuperOne/MCP Tools/Browser',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

/** One of each browser tool in a typical complete state. */
export const Gallery: Story = {
  render: () => (
    <StoryShell width={760}>
      {tool('navigate', { input: { url: 'https://example.com/login', description: 'Open login page' }, result: JSON.stringify({ ok: true, url: 'https://example.com/login' }) })}
      {tool('open', { input: { url: 'https://docs.example.com' }, result: JSON.stringify({ ok: true, tab: 't2', url: 'https://docs.example.com' }) })}
      {tool('snapshot', { input: { filter: 'interactive' }, result: TOON_SNAPSHOT })}
      {tool('query', { input: { role: 'button', text: 'Continue' }, result: TOON_QUERY })}
      {tool('inspect', { input: { selector: '#email' }, result: JSON.stringify({ exists: true, tag: 'input', type: 'email', name: 'email' }) })}
      {tool('click', { input: { selector: 'button.submit', description: 'Submit checkout' }, result: JSON.stringify({ ok: true }) })}
      {tool('hover', { input: { text: 'Account' }, result: JSON.stringify({ ok: true }) })}
      {tool('type', { input: { selector: '#email', text: 'ada@example.com', description: 'Fill email' }, result: JSON.stringify({ ok: true }) })}
      {tool('press', { input: { key: 'Enter', modifiers: ['Meta'] }, result: JSON.stringify({ ok: true }) })}
      {tool('scroll', { input: { deltaY: 400 }, result: JSON.stringify({ ok: true }) })}
      {tool('drag', { input: { from: { selector: '#card' }, to: { selector: '#drop' } }, result: JSON.stringify({ ok: true }) })}
      {tool('select', { input: { selector: 'select#country', value: 'US' }, result: JSON.stringify({ ok: true }) })}
      {tool('wait_for', { input: { selectorGone: '.spinner', urlIncludes: '/done' }, result: JSON.stringify({ ok: true }) })}
      {tool('tabs', { result: TOON_TABS })}
      {tool('resize', { input: { preset: 'mobile' }, result: JSON.stringify({ ok: true, width: 375, height: 812 }) })}
      {tool('evaluate', { input: { expression: 'document.title' }, result: JSON.stringify({ value: 'Checkout' }) })}
      {tool('screenshot', { input: { selector: '#hero' }, result: JSON.stringify({ path: '/tmp/shot.png', width: 800, height: 600 }) })}
      {tool('network_start', { input: { match: '/api', resourceTypes: ['XHR', 'Fetch'] }, result: 'recordingId: rec-1\ncapturing: true' })}
      {tool('network_stop', { input: { recordingId: 'rec-1' }, result: TOON_NETWORK_STOP })}
      {tool('network_wait', { input: { recordingId: 'rec-1', url: '/orders' }, result: TOON_NETWORK_WAIT })}
      {tool('network_body', { input: { recordingId: 'rec-1', requestId: 'r2' }, result: TOON_NETWORK_BODY })}
      {tool('cookies', { result: TOON_COOKIES })}
      {tool('upload_file', { input: { selector: '#file', files: ['/tmp/a.pdf', '/tmp/b.pdf'] }, result: JSON.stringify({ ok: true, files: 2 }) })}
      {tool('emulate', { input: { width: 390, height: 844, mobile: true }, result: JSON.stringify({ ok: true, reset: false }) })}
      {tool('mock', { input: { url: '/api/me', status: 200, body: '{"ok":true}' }, result: JSON.stringify({ ok: true, mocking: '/api/me' }) })}
      {tool('download', {
        input: { url: 'https://cdn.example.com/report.pdf', description: 'Save quarterly report' },
        result: JSON.stringify({
          status: 'completed',
          taskId: 'bdl_story1',
          path: '/tmp/super-one-browser-downloads/uuid/report.pdf',
          filename: 'report.pdf',
          bytes: 245760,
          mimeType: 'application/pdf',
          url: 'https://cdn.example.com/report.pdf',
        }),
      })}
      {tool('list_downloads', {
        input: { state: 'completed', wait: false },
        result: JSON.stringify({
          count: 2,
          downloads: [
            { filename: 'export.csv', path: '/tmp/dl/export.csv', bytes: 4096, state: 'completed', url: 'https://example.com/export.csv', startedAt: 2 },
            { filename: 'invoice.pdf', path: '/tmp/dl/invoice.pdf', bytes: 88200, state: 'completed', url: 'https://example.com/invoice.pdf', startedAt: 1 },
          ],
        }),
      })}
    </StoryShell>
  ),
}

export const StreamingActions: Story = {
  name: 'Streaming (actions)',
  render: () => (
    <>
      {tool('navigate', { input: { url: 'https://example.com' }, status: 'streaming', elapsedSeconds: 2 })}
      {tool('open', { input: { url: 'https://docs.example.com' }, status: 'streaming', elapsedSeconds: 1 })}
      {tool('click', { input: { selector: '#submit', description: 'Click submit' }, status: 'streaming', elapsedSeconds: 1 })}
      {tool('type', { input: { selector: '#password', text: 'hunter2' }, status: 'streaming', elapsedSeconds: 1 })}
      {tool('wait_for', { input: { selector: '.ready' }, status: 'streaming', elapsedSeconds: 5 })}
      {tool('upload_file', { input: { selector: '#file', files: ['/tmp/a.pdf'] }, status: 'streaming', elapsedSeconds: 2 })}
      {tool('network_start', { input: { match: '/api' }, status: 'streaming', elapsedSeconds: 1 })}
      {tool('network_wait', { input: { recordingId: 'rec-1', url: '/orders' }, status: 'streaming', elapsedSeconds: 3 })}
      {tool('list_downloads', { input: { state: 'completed' }, status: 'streaming', elapsedSeconds: 2 })}
      {tool('screenshot', { input: { selector: '#hero' }, status: 'streaming', elapsedSeconds: 1 })}
      {tool('emulate', { input: { mobile: true }, status: 'streaming', elapsedSeconds: 1 })}
      {tool('download', { input: { url: 'https://cdn.example.com/report.pdf' }, status: 'streaming', elapsedSeconds: 4 })}
    </>
  ),
}

export const ErrorsAndDenied: Story = {
  render: () => (
    <>
      {tool('click', { input: { selector: '#gone' }, result: JSON.stringify({ ok: false, error: 'element not found' }) })}
      {tool('inspect', { input: { selector: '#missing' }, result: JSON.stringify({ exists: false }) })}
      {tool('network_wait', {
        input: { recordingId: 'rec-1', url: '/gone', timeoutMs: 1000 },
        result: '[Error] Timed out after 1000ms waiting for a request matching "/gone"',
        isError: true,
      })}
      {tool('download', {
        input: { url: 'https://example.com/missing.bin' },
        result: '[Error] HTTP 404 Not Found',
        isError: true,
      })}
      {tool('navigate', {
        input: { url: 'https://internal.corp' },
        result: '[denied] User denied permission',
      })}
    </>
  ),
}

export const DownloadStreaming: Story = {
  name: 'Download / Streaming',
  render: () =>
    tool('download', {
      input: { url: 'https://cdn.example.com/large.zip', description: 'Fetch release archive' },
      status: 'streaming',
      elapsedSeconds: 4,
    }),
}

export const DownloadCompleted: Story = {
  name: 'Download / Completed',
  render: () =>
    tool('download', {
      input: { url: 'https://cdn.example.com/report.pdf' },
      result: JSON.stringify({
        status: 'completed',
        taskId: 'bdl_done',
        path: '/tmp/super-one-browser-downloads/abc/report.pdf',
        filename: 'report.pdf',
        bytes: 245760,
        mimeType: 'application/pdf',
        url: 'https://cdn.example.com/report.pdf',
      }),
    }),
}

export const DownloadBackground: Story = {
  name: 'Download / Background + progress',
  render: () => {
    function Seeded() {
      useLayoutEffect(() => {
        seedBrowserDownload('bdl_bg', {
          status: 'progressing',
          filename: 'dataset.csv',
          bytes: 3_200_000,
          totalBytes: 8_000_000,
          mimeType: 'text/csv',
          url: 'https://cdn.example.com/dataset.csv',
        })
      }, [])
      return tool('download', {
        input: { url: 'https://cdn.example.com/dataset.csv', timeoutMs: 200 },
        result: JSON.stringify({
          status: 'background',
          taskId: 'bdl_bg',
          url: 'https://cdn.example.com/dataset.csv',
          message: 'Download still running after 200ms; moved to background as task bdl_bg.',
        }),
      })
    }
    return <Seeded />
  },
}

export const DownloadFailed: Story = {
  name: 'Download / Failed',
  render: () =>
    tool('download', {
      input: { url: 'https://cdn.example.com/gone.bin' },
      result: JSON.stringify({
        status: 'failed',
        taskId: 'bdl_fail',
        url: 'https://cdn.example.com/gone.bin',
        error: 'HTTP 404 Not Found',
      }),
      isError: true,
    }),
}

export const ListDownloadsEmpty: Story = {
  name: 'List downloads / Empty',
  render: () =>
    tool('list_downloads', {
      input: { wait: true, timeoutMs: 3000, state: 'all' },
      result: JSON.stringify({ count: 0, downloads: [] }),
    }),
}

export const ListDownloadsWithItems: Story = {
  name: 'List downloads / Items',
  render: () =>
    tool('list_downloads', {
      input: { state: 'completed', wait: false },
      result: JSON.stringify({
        count: 3,
        downloads: [
          { filename: 'a.txt', path: '/tmp/dl/a.txt', bytes: 12, state: 'completed', url: 'https://x.test/a.txt', startedAt: 3 },
          { filename: 'b.csv', path: '/tmp/dl/b.csv', bytes: 4096, state: 'completed', url: 'https://x.test/b.csv', startedAt: 2 },
          { filename: 'c.pdf', path: '/tmp/dl/c.pdf', bytes: 99000, state: 'completed', url: 'https://x.test/c.pdf', startedAt: 1 },
        ],
      }),
    }),
}

export const ListDownloadsMixed: Story = {
  name: 'List downloads / Mixed states',
  render: () =>
    tool('list_downloads', {
      input: { state: 'all', wait: false },
      result: JSON.stringify({
        count: 4,
        downloads: [
          { filename: 'report.pdf', path: '/tmp/dl/report.pdf', bytes: 245760, state: 'completed', url: 'https://cdn.example.com/report.pdf', startedAt: 4 },
          { filename: 'export.csv', path: '/tmp/dl/export.csv', bytes: 18432, state: 'progressing', url: 'https://example.com/export.csv', startedAt: 3 },
          { filename: 'invoice.pdf', path: '/tmp/dl/invoice.pdf', bytes: 0, state: 'interrupted', url: 'https://example.com/invoice.pdf', startedAt: 2 },
          { filename: 'draft.zip', path: '/tmp/dl/draft.zip', bytes: 512, state: 'cancelled', url: 'https://example.com/draft.zip', startedAt: 1 },
        ],
      }),
    }),
}

export const ListDownloadsProgressing: Story = {
  name: 'List downloads / Progressing filter',
  render: () =>
    tool('list_downloads', {
      input: { state: 'progressing', wait: true, timeoutMs: 5000 },
      result: JSON.stringify({
        count: 1,
        downloads: [
          { filename: 'big.bin', path: '/tmp/dl/big.bin', bytes: 1024, state: 'progressing', url: 'https://x.test/big.bin', startedAt: 1 },
        ],
      }),
    }),
}

export const ReadOps: Story = {
  name: 'Read ops (expandable)',
  render: () => (
    <>
      {tool('snapshot', { input: { include: ['meta', 'elements'] }, result: TOON_SNAPSHOT })}
      {tool('query', { input: { role: 'link', text: 'Docs' }, result: TOON_QUERY })}
      {tool('tabs', { result: TOON_TABS })}
      {tool('evaluate', { input: { expression: 'location.href' }, result: JSON.stringify({ value: 'https://example.com/app' }) })}
      {tool('cookies', { input: { urls: ['https://example.com'] }, result: TOON_COOKIES })}
      {tool('network_stop', { input: { recordingId: 'rec-1' }, result: TOON_NETWORK_STOP })}
      {tool('network_body', { input: { recordingId: 'rec-1', requestId: 'r2' }, result: TOON_NETWORK_BODY })}
    </>
  ),
}

export const DeviceAndMock: Story = {
  name: 'Emulate / Mock / Upload / Resize',
  render: () => (
    <>
      {tool('resize', { input: { preset: 'tablet' }, result: JSON.stringify({ ok: true, width: 768, height: 1024 }) })}
      {tool('resize', { input: { reset: true }, result: JSON.stringify({ ok: true, reset: true }) })}
      {tool('emulate', { input: { width: 390, height: 844, mobile: true, colorScheme: 'dark' }, result: JSON.stringify({ ok: true }) })}
      {tool('emulate', { input: { reset: true }, result: JSON.stringify({ ok: true, reset: true }) })}
      {tool('mock', { input: { url: '/api/search', status: 200, contentType: 'application/json', body: '[]' }, result: JSON.stringify({ ok: true, mocking: '/api/search' }) })}
      {tool('mock', { input: { clear: true }, result: JSON.stringify({ ok: true, clear: true }) })}
      {tool('upload_file', { input: { selector: 'input[type=file]', files: ['/Users/me/docs/resume.pdf'] }, result: JSON.stringify({ ok: true, files: 1 }) })}
    </>
  ),
}

export const InteractionVariety: Story = {
  name: 'Interactions (click / type / drag / select / press / scroll / hover)',
  render: () => (
    <>
      {tool('click', { input: { selector: '#pay', description: 'Pay now' }, result: JSON.stringify({ ok: true }) })}
      {tool('click', { input: { text: 'Log in' }, result: JSON.stringify({ ok: true }) })}
      {tool('click', { input: { x: 120, y: 340 }, result: JSON.stringify({ ok: true }) })}
      {tool('hover', { input: { selector: 'nav .menu' }, result: JSON.stringify({ ok: true }) })}
      {tool('type', { input: { selector: '#email', text: 'ada@lovelace.dev', clear: true }, result: JSON.stringify({ ok: true }) })}
      {tool('type', { input: { selector: '#password', text: 's3cret-value-here' }, result: JSON.stringify({ ok: true }) })}
      {tool('press', { input: { key: 'Enter' }, result: JSON.stringify({ ok: true }) })}
      {tool('press', { input: { key: 'k', modifiers: ['Meta'] }, result: JSON.stringify({ ok: true }) })}
      {tool('scroll', { input: { deltaY: 800 }, result: JSON.stringify({ ok: true }) })}
      {tool('scroll', { input: { selector: '#sidebar', deltaY: 200 }, result: JSON.stringify({ ok: true }) })}
      {tool('drag', { input: { from: { text: 'Card A' }, to: { x: 40, y: 80 } }, result: JSON.stringify({ ok: true }) })}
      {tool('select', { input: { selector: '#plan', label: 'Pro' }, result: JSON.stringify({ ok: true }) })}
      {tool('select', { input: { selector: 'input[type=checkbox]', checked: true }, result: JSON.stringify({ ok: true }) })}
    </>
  ),
}
