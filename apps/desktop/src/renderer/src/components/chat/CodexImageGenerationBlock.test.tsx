/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CodexImageGenerationBlock } from './CodexImageGenerationBlock'

describe('CodexImageGenerationBlock', () => {
  it('uses the shared Tool UI error chrome for failed generation', () => {
    const { container } = render(
      <CodexImageGenerationBlock
        item={{
          id: 'image-failed',
          type: 'image_generation',
          status: 'failed',
          revisedPrompt: 'a red cube',
        }}
      />,
    )

    expect(container.querySelector('.tool-node')).toHaveClass('errored', 'bg-warning/10')
    expect(screen.getByText('Generate Image')).toBeTruthy()
    expect(screen.getByText('Error')).toBeTruthy()
  })
})
