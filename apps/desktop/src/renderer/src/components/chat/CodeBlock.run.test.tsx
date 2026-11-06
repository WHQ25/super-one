/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Streamdown } from 'streamdown'
import { HighlightedCodeBlock, createStreamdownCodeComponent } from './CodeBlock'
import { CodeBlockProjectScope } from './code-block-project-scope'
import { useChatStore } from '@/stores/chat'
import { codePlugin } from './code-plugins'
import { SessionScopeProvider } from '@/stores/chat-store/session-scope'
import { useTerminalStore } from '@/stores/terminal'
import { projectSessionKey } from '@superone/shared/remote-resource-key'

const Code = createStreamdownCodeComponent(codePlugin)
const create = vi.fn()
const script = "name='你好'\nprintf '%s\\n' \"$name\"\n"

function block(language = 'bash', code = script) {
  return render(<SessionScopeProvider value={{ projectPath: '/project with spaces', sessionId: 's1' }}>
    <Streamdown components={{ code: Code } as never}>{`\`\`\`${language}\n${code}\`\`\``}</Streamdown>
  </SessionScopeProvider>)
}

beforeEach(() => {
  create.mockReset().mockResolvedValue({ terminalId: 't1', cwd: '/project with spaces', title: 'Bash', status: 'running', ownerDeviceId: null })
  window.terminal = { create } as unknown as Window['terminal']
  useTerminalStore.setState({ byProject: {}, openBySession: {} })
  useChatStore.setState({ activeProject: null })
})
afterEach(cleanup)

describe('running a markdown shell block', () => {
  it('opens a separate terminal at the scoped project root and passes the entire script unchanged', async () => {
    block()
    fireEvent.click(screen.getByRole('button', { name: 'Run Shell' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ projectPath: '/project with spaces', title: 'Shell', bashScript: script }))
    expect(useTerminalStore.getState().byProject['/project with spaces'].activeId).toBe('t1')
    expect(useTerminalStore.getState().openBySession[projectSessionKey('/project with spaces', 's1')]).toBe(true)
  })

  it('prevents repeated clicks during launch and lets the user retry a failed launch', async () => {
    let reject!: (error: Error) => void
    create.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    block()
    const run = screen.getByRole('button', { name: 'Run Shell' })
    fireEvent.click(run)
    fireEvent.click(run)
    expect(create).toHaveBeenCalledTimes(1)
    expect(run).toBeDisabled()
    reject(new Error('Bash is unavailable'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bash is unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Run Shell' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
  })

  it.each(['sh', 'shell', 'zsh', 'ZSH'])('offers execution for a %s fence', (language) => {
    block(language, 'pwd\n')
    expect(screen.getByRole('button', { name: 'Run Shell' })).toBeEnabled()
  })

  it('does not offer execution for other languages', () => {
    block('python', 'print(42)\n')
    expect(screen.queryByRole('button', { name: 'Run Shell' })).toBeNull()
    cleanup()
    block('console', 'ls\n')
    expect(screen.queryByRole('button', { name: 'Run Shell' })).toBeNull()
  })

  it('disables incomplete, empty, and projectless blocks', () => {
    const { rerender } = render(<HighlightedCodeBlock code="pwd" language="bash" codePlugin={codePlugin} />)
    expect(screen.getByRole('button', { name: 'Run Shell' })).toBeDisabled()
    rerender(<CodeBlockProjectScope value="/docs"><HighlightedCodeBlock code="pwd" language="bash" codePlugin={codePlugin} isComplete={false} /></CodeBlockProjectScope>)
    expect(screen.getByRole('button', { name: 'Run Shell' })).toBeDisabled()
    rerender(<CodeBlockProjectScope value="/docs"><HighlightedCodeBlock code={' \n'} language="bash" codePlugin={codePlugin} /></CodeBlockProjectScope>)
    expect(screen.getByRole('button', { name: 'Run Shell' })).toBeDisabled()
    expect(create).not.toHaveBeenCalled()
  })

  it('uses the Markdown project outside chat even if another project is active', async () => {
    useChatStore.setState({ activeProject: '/other' })
    render(<CodeBlockProjectScope value="/docs"><HighlightedCodeBlock code="pwd" language="bash" codePlugin={codePlugin} /></CodeBlockProjectScope>)
    fireEvent.click(screen.getByRole('button', { name: 'Run Shell' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ projectPath: '/docs', title: 'Shell', bashScript: 'pwd' }))
  })
})
