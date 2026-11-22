// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ModelOption } from '@superone/shared/agent-types'
import { ModelChangeSeparator } from './ModelChangeSeparator'

vi.mock('@/components/providers/ModelGlyph', () => ({
  ModelGlyph: ({ modelId, modelName }: { modelId: string; modelName?: string | null }) => (
    <span data-testid={`model-glyph-${modelId}`} data-model-name={modelName ?? ''} />
  ),
}))

const CATALOG: ModelOption[] = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '' },
  { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash', description: '' },
]

describe('ModelChangeSeparator', () => {
  it('renders icons and display names for both fromModel and toModel', () => {
    render(
      <ModelChangeSeparator
        meta={{ fromModel: 'deepseek-v4-pro', toModel: 'gemini-3.1-flash' }}
        models={CATALOG}
      />,
    )

    expect(screen.getByRole('separator')).toHaveAttribute('data-model-change', 'deepseek-v4-pro->gemini-3.1-flash')
    expect(screen.getByTestId('model-glyph-deepseek-v4-pro')).toBeInTheDocument()
    expect(screen.getByTestId('model-glyph-gemini-3.1-flash')).toBeInTheDocument()
    expect(screen.getByText('DeepSeek V4 Pro')).toBeInTheDocument()
    expect(screen.getByText('Gemini 3.1 Flash')).toBeInTheDocument()
  })

  it('falls back to shortened model ids when models are absent from catalog', () => {
    render(
      <ModelChangeSeparator
        meta={{ fromModel: 'claude-sonnet-4-5', toModel: 'gpt-5.4' }}
      />,
    )

    expect(screen.getByText('sonnet-4-5')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument()
  })
})
