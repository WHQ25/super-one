import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppDesktopApi } from './desktop-executor'
import viewHtml from '../../../../test/fixtures/mcp-apps/fixture-view.html?raw'
export type McpAppStoryState = 'live' | 'loading' | 'inactive' | 'missing' | 'approval' | 'auth' | 'error' | 'unknown' | 'revoked' | 'long'
export function createMcpAppStoryFixture(state: McpAppStoryState = 'live') {
  let active = !['inactive', 'missing'].includes(state), authenticated = state !== 'auth', registrations = 0, url = ''
  const listeners = new Set<(value: { url: string }) => void>()
  const result = (page = 1) => ({ content: [{ type: 'text', text: `page ${page}` }], structuredContent: { page, pageCount: 4, items: Array.from({ length: state === 'long' ? 60 : 4 }, (_, n) => `Item ${page}-${n + 1} · A useful result with a longer description`) }, _meta: { private: 'View only' } })
  const app: ToolAppAttachment = { appInstanceId: 'storybook-view', binding: { node: 'local', session: 'storybook-session', server: 'MCP Apps Fixture', configGeneration: 1, configFingerprint: 'fixture' }, origin: { providerSessionId: 'storybook-thread' }, resourceUri: 'ui://fixture/view', status: 'result', toolInput: { page: 1 }, toolResult: result() }
  const api: McpAppDesktopApi = {
    async mcpAppRegister() {
      if (state === 'loading') return new Promise(() => {})
      if (!authenticated) return { ok: false, error: { code: 'auth_required', message: 'Sign in to the fixture server to connect.' } }
      if (state === 'error' && registrations++ === 0) return { ok: false, error: { code: 'not_connected', message: 'The fixture server is unavailable.' } }
      if (state === 'missing' && !active) return { ok: true, value: { state: 'inactive' } }
      let html = viewHtml
      if (['approval', 'unknown'].includes(state)) html = html.replace("log('initialized')", "log('initialized'); document.getElementById('" + (state === 'approval' ? 'ask' : 'next') + "').click()")
      url = 'data:text/html;base64,' + btoa(String.fromCharCode(...new TextEncoder().encode(html)))
      return { ok: true, value: { state: 'ready', document: { id: crypto.randomUUID(), url, origin: 'null', appInstanceId: app.appInstanceId }, active, meta: {} } }
    },
    async mcpAppRequest(_project, _session, request) {
      if (request.operation === 'activate') { active = true; return { ok: true, value: {} } }
      if (request.operation === 'callTool' && state === 'unknown') return { ok: true, value: { outcome: 'unknown_outcome', result: { isError: true, content: [{ type: 'text', text: 'Server disconnected after dispatch' }] } } }
      if (!request.approval && request.operation === 'sendMessage') return { ok: false, error: { code: 'approval_required', challenge: 'storybook-challenge', prompt: { kind: 'sendMessage', server: app.binding.server, text: request.params.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'), nonTextBlocks: 0 } } }
      return { ok: true, value: request.operation === 'callTool' ? { outcome: 'completed', result: result(Number(request.args.page ?? 2)) } : {} }
    },
    async mcpAppsAuthenticate() { authenticated = true; return { ok: true, value: null } },
    async mcpAppRelease() {}, async mcpAppCancel() {},
    onMcpAppDocumentRevoked(callback) { listeners.add(callback); return () => { listeners.delete(callback) } },
  }
  return { app, api, revoke: () => listeners.forEach(callback => callback({ url })) }
}
