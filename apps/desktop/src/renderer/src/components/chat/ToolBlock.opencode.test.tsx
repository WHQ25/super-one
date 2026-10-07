/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { openFileTab } from '@/components/activity/activity-panel-api'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
import { groupContent } from './chat-message/groupContent'
import { parsePatchToolText } from '@superone/shared/patch-tool'
import { NestedToolContext } from './nested-tool-context'

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({ toolRenderers: {}, activeProject: '/proj', projectSessions: {} }),
  useActiveSession: (selector: (state: unknown) => unknown) => selector({ cwd: '/proj', homedir: '/Users/test', _streamingToolInputPreviews: {} }),
  useBashOutput: () => ({ chunks: [], completed: true }),
}))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({ mcpMeta: {}, mcpLibrary: [] }),
}))
vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: (selector: (state: unknown) => unknown) => selector({ apps: [] }),
}))
vi.mock('@/lib/stall-utils', () => ({ useStallLevel: () => 0, getStallColor: () => '' }))
vi.mock('@/components/activity/activity-panel-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), openFileTab: vi.fn(),
}))

// JSDOM has no canvas text metrics. The production diff view measures mono
// glyphs in an idle callback; stub that browser boundary, not the diff renderer.
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
  font: '12px monospace',
  measureText: (text: string) => ({ width: text.length * 7 }),
} as unknown as CanvasRenderingContext2D)

const { ToolBlock } = await import('./ToolBlock')

describe('OpenCode historical tool rows', () => {
  it('shows unique file count and accumulated line totals in the collapsed patch header', () => {
    const patchText = '*** Begin Patch\n*** Update File: /repo/a.ts\n@@\n-old\n+new\n+extra\n*** Update File: /repo/a.ts\n@@\n-old2\n+new2\n*** Add File: /repo/b.ts\n+one\n+two\n*** End Patch'
    render(<ToolBlock toolName="Patch" input={JSON.stringify({ patchText })} status="complete" autoExpand={false} />)
    expect(screen.getByText('2 files')).toBeInTheDocument()
    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.getByText('-2')).toBeInTheDocument()
    expect(screen.queryByText('a.ts')).toBeNull()
    fireEvent.click(screen.getByText('Patch Applied'))
    expect(screen.getByText('b.ts')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Patch Applied'))
    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.getByText('-2')).toBeInTheDocument()
  })

  it('keeps thinking adjacent across hidden rename calls and their results', () => {
    const grouped = groupContent([
      { type: 'thinking', thinking: 'Before' },
      { type: 'tool_use', toolName: 'superone_session_rename', toolUseId: 'rename', input: '{}' },
      { type: 'tool_result', toolUseId: 'rename', summary: 'Session renamed' },
      { type: 'thinking', thinking: 'After' },
    ], [])
    expect(grouped.segments).toHaveLength(1)
    expect(grouped.segments[0]).toMatchObject({ kind: 'thinking', blocks: [{ thinking: 'Before' }, { thinking: 'After' }] })
  })

  it('does not confuse OpenCode code mode with the Grok execute shell alias', () => {
    render(<ToolBlock toolName="execute" input='{"code":"return await tools.example()"}' status="complete" />)
    expect(screen.getByText('Code Executed')).toBeInTheDocument()
    expect(screen.queryByText('Bash')).toBeNull()
  })

  it('keeps code and output in expandable details, not the code execution header', () => {
    const { container } = render(<ToolBlock toolName="execute" input='{"code":"return await tools.example()"}' result="Done" status="complete" />)
    expect(container.querySelector('.tool-node')!.firstElementChild!.textContent).not.toContain('return await')
    fireEvent.click(screen.getByText('Code Executed'))
    expect(screen.getByText('return await tools.example()')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it.each(['patch', 'apply_patch', 'Patch', 'Edit'])('shows file chips and per-file diffs for %s', async (toolName) => {
    const patchText = '*** Begin Patch\n*** Update File: /proj/a.ts\n@@\n-old\n+new\n*** Add File: /proj/b.ts\n+hello\n*** End Patch'
    const { container } = render(<ToolBlock toolName={toolName} input={JSON.stringify({ patchText })} status="complete" />)
    expect(screen.getByText('Patch Applied')).toBeInTheDocument()
    expect(screen.getByText('2 files')).toBeInTheDocument()
    expect(container.textContent).not.toContain('*** Begin Patch')
    await act(async () => { fireEvent.click(screen.getByText('Patch Applied')) })
    fireEvent.click(screen.getByText('a.ts'))
    expect(openFileTab).toHaveBeenCalledWith('/proj/a.ts')
    expect(screen.getByText('b.ts')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(container.textContent).not.toContain('hello')
  })

  it('renders the patch diff on the phone once detail files arrive', () => {
    const patchText = '*** Begin Patch\n*** Update File: /proj/a.ts\n@@\n-old\n+new\n*** Add File: /proj/b.ts\n+hello\n*** End Patch'
    render(<PortableToolRow toolName="Patch" input={JSON.stringify({ files: parsePatchToolText(patchText) })} status="complete" />)
    fireEvent.click(screen.getByText('Patch Applied'))
    expect(screen.queryByText('new')).toBeNull()
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Write'))
    expect(screen.getByText('new')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('keeps a legacy Edit-shaped patch recognizable after phone privacy projection', () => {
    const input = sanitizeRemoteToolInput('Edit', JSON.stringify({ patchText: '*** Begin Patch\n*** Add File: /repo/a.ts\n+private-body\n*** End Patch' }))
    const { container } = render(<PortableToolRow toolName="Edit" input={input} status="complete" />)
    fireEvent.click(screen.getByText('Patch Applied'))
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(container.textContent).not.toContain('private-body')
  })

  it('expands only the chosen file, like Claude Bash’s changed-file list', () => {
    const files = parsePatchToolText('*** Begin Patch\n*** Update File: /repo/a.ts\n@@\n-old\n+new\n*** Add File: /repo/b.ts\n+hello\n*** Delete File: /repo/c.ts\n*** End Patch')
    render(<PortableToolRow toolName="Patch" input={JSON.stringify({ files })} status="complete" defaultExpanded />)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.queryByText('new')).toBeNull()
    expect(screen.queryByText('hello')).toBeNull()
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByText('new')).toBeInTheDocument()
    expect(screen.queryByText('hello')).toBeNull()
  })

  it('does not classify a raw shell execute alias as JavaScript', () => {
    render(<ToolBlock toolName="execute" input='{"command":"ls"}' status="complete" />)
    expect(screen.queryByText('Code Executed')).toBeNull()
  })

  it.each(['Patch', 'CodeExecution'])('shows streaming and denied %s labels without claiming completion', (toolName) => {
    const { rerender } = render(<ToolBlock toolName={toolName} input="{}" status="streaming" />)
    expect(screen.getByText(toolName === 'Patch' ? 'Applying patch…' : 'Executing code…')).toBeInTheDocument()
    rerender(<ToolBlock toolName={toolName} input="{}" status="complete" result="[denied] Not permitted" />)
    expect(screen.getByText(toolName === 'Patch' ? 'Apply Patch' : 'Execute Code')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Denied'))
    expect(screen.getByText('Not permitted')).toBeInTheDocument()
  })

  it('keeps patch and code calls header-only inside subagents', () => {
    const { container } = render(<NestedToolContext.Provider value={{ allowExpand: false }}>
      <ToolBlock toolName="Patch" input='{"patchText":"*** Begin Patch\n*** Add File: /repo/a.ts\n+private-body\n*** End Patch"}' status="complete" />
      <ToolBlock toolName="CodeExecution" input='{"code":"private script"}' result="private result" status="complete" />
    </NestedToolContext.Provider>)
    expect(screen.getByText('Patch Applied')).toBeInTheDocument()
    expect(screen.getByText('Code Executed')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/private-body|private script|private result/)
    expect(container.querySelector('.lucide-chevron-right')).toBeNull()
  })

  it.each(['CodeExecution', 'execute'])('keeps the %s code-mode identity on a privacy-projected phone row', (toolName) => {
    const input = sanitizeRemoteToolInput(toolName, '{"code":"return await tools.example()"}')
    const { container } = render(<PortableToolRow toolName={toolName} input={input} result="Done" status="complete" />)
    expect(screen.getByText('Code Executed')).toBeInTheDocument()
    expect(container.textContent).not.toContain('return await')
  })

  it.each(['Patch', 'CodeExecution'])('keeps failed %s rows expandable instead of claiming success', (toolName) => {
    render(<ToolBlock toolName={toolName} input="{}" result="Execution failed" isError status="complete" />)
    expect(screen.queryByText('Patch Applied')).toBeNull()
    expect(screen.queryByText('Code Executed')).toBeNull()
    fireEvent.click(screen.getByText('Error'))
    expect(screen.getByText('Execution failed')).toBeInTheDocument()
  })

  it.each(['streaming', 'complete'] as const)('hides session rename while %s', (status) => {
    const { container } = render(<ToolBlock toolName="superone_session_rename" input='{"title":"New title"}' result="Session renamed" status={status} />)
    expect(container.firstChild).toBeNull()
  })

  it.each(['path', 'filePath'])('opens the Read file chip from the saved %s field', (field) => {
    render(<ToolBlock toolName="Read" input={JSON.stringify({ [field]: '/proj/a.ts', offset: 5, limit: 10 })} result="file contents" status="complete" />)
    fireEvent.click(screen.getByText('a.ts'))
    expect(openFileTab).toHaveBeenCalledWith('/proj/a.ts')
    expect(screen.getByText('L5–14')).toBeInTheDocument()
    expect(screen.queryByText('file contents')).toBeNull()
  })

  it.each(['streaming', 'complete'] as const)('uses the compact Skill row while %s instead of a raw JSON fallback', (status) => {
    const { container } = render(<ToolBlock toolName="skill" input='{"id":"opencode"}' result="skill instructions" status={status} />)
    expect(screen.getByText('opencode')).toBeInTheDocument()
    expect(screen.getByText(status === 'streaming' ? 'Running…' : 'Skill')).toBeInTheDocument()
    expect(container.textContent).not.toContain('{"id"')
    expect(screen.queryByText('skill instructions')).toBeNull()
    expect(container.querySelector('.cursor-pointer')).toBeNull()
  })

  it('routes an OpenCode host call to the existing designed row', () => {
    render(<ToolBlock toolName="superone_read_manual" input='{"domain":"product","topic":"browser"}' result="manual" status="complete" />)
    expect(screen.getByText('Manual Read')).toBeInTheDocument()
    expect(screen.getByText('product/browser')).toBeInTheDocument()
  })

  it('keeps Read and Skill identities on the phone after privacy projection', () => {
    render(<>
      <PortableToolRow toolName="Read" input={sanitizeRemoteToolInput('Read', '{"path":"/proj/a.ts"}')} status="complete" />
      <PortableToolRow toolName="skill" input={sanitizeRemoteToolInput('skill', '{"id":"opencode"}')} status="complete" />
    </>)
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('opencode')).toBeInTheDocument()
    expect(screen.getByText('Skill')).toBeInTheDocument()
  })

  it('does not flash raw JSON before the Skill id arrives', () => {
    const { container } = render(<ToolBlock toolName="skill" input="{}" status="streaming" />)
    expect(container.textContent).not.toContain('{}')
  })

  it.each([
    ['Read', { path: '/proj/a.ts' }, 'a.ts'],
    ['skill', { id: 'opencode' }, 'opencode'],
  ])('keeps failed %s details readable with the correct identity', (toolName, input, label) => {
    render(<ToolBlock toolName={toolName} input={JSON.stringify(input)} result="Not found" isError status="complete" />)
    expect(screen.getByText(label)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Error'))
    expect(screen.getByText('Not found')).toBeInTheDocument()
  })
})
