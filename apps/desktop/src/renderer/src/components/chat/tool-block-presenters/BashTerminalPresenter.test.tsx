/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BashTerminalPresenter } from './BashTerminalPresenter'

const noopReadMore = vi.fn(async () => '')

describe('BashTerminalPresenter', () => {
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
