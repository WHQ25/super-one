/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BashTerminalPresenter } from './BashTerminalPresenter'

const noopReadMore = vi.fn(async () => '')

describe('BashTerminalPresenter', () => {
  it('shows the description in the header and the command only after expand', () => {
    const { container } = render(
      <BashTerminalPresenter
        toolUseId="grok-bash"
        command="ls -la"
        description="List workspace files"
        isStreaming={false}
        fallbackResult="file.ts"
        readOutputFile={noopReadMore}
        readOutputMore={noopReadMore}
        renderAnsiText={(text) => text}
      />,
    )

    expect(screen.getByText('List workspace files')).toBeInTheDocument()
    expect(container.querySelector('.bg-terminal-bg')).toBeNull()
    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(container.querySelector('.bg-terminal-bg')).not.toBeNull()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    expect(screen.getByText('file.ts')).toBeInTheDocument()
  })

  it('notifies the host when the row expands so deferred details can load', () => {
    const onExpandedChange = vi.fn()
    const { container } = render(
      <BashTerminalPresenter
        toolUseId="deferred-bash"
        command="pwd"
        description="Print working directory"
        isStreaming={false}
        onExpandedChange={onExpandedChange}
        detailStatus="Loading"
        readOutputFile={noopReadMore}
        readOutputMore={noopReadMore}
        renderAnsiText={(text) => text}
      />,
    )

    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(onExpandedChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })

  it('stays header-only when expansion is disabled by the host', () => {
    const readOutputFile = vi.fn(async () => 'saved output')

    render(
      <BashTerminalPresenter
        toolUseId="tool-1"
        command="bun test"
        isStreaming={false}
        allowExpand={false}
        bashOutput={{ content: 'live output', finished: true }}
        readOutputFile={readOutputFile}
        readOutputMore={noopReadMore}
        renderAnsiText={(text) => text}
      />,
    )

    expect(screen.getByText('bun test')).not.toBeNull()
    expect(screen.queryByText('live output')).toBeNull()
    fireEvent.click(screen.getByText('bun test'))
    expect(screen.queryByText('live output')).toBeNull()
    expect(readOutputFile).not.toHaveBeenCalled()
  })

  it('restores expired output through the injected reader', async () => {
    const readOutputFile = vi.fn(async () => 'restored output')
    const renderAnsiText = vi.fn((text: string) => <span>{text}</span>)

    render(
      <BashTerminalPresenter
        toolUseId="tool-2"
        command="bun run build"
        isStreaming={false}
        resultOutputPath="/tmp/tool-2.log"
        readOutputFile={readOutputFile}
        readOutputMore={noopReadMore}
        renderAnsiText={renderAnsiText}
      />,
    )

    await waitFor(() => expect(readOutputFile).toHaveBeenCalledWith('/tmp/tool-2.log', 50))
    fireEvent.click(screen.getByText('bun run build'))
    await waitFor(() => expect(screen.getByText('restored output')).not.toBeNull())
    expect(renderAnsiText).toHaveBeenCalledWith('restored output')
  })
})
