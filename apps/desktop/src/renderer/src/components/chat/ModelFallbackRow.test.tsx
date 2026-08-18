/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import type { ModelOption } from '@superone/shared/agent-types'
import { describe, expect, it } from 'vitest'
import { ModelFallbackRow, resolveModelDisplayName, shortModelName } from './ModelFallbackRow'

const CATALOG = [
  { id: 'claude-opus-5', name: 'Opus 5', description: '' },
  { id: 'claude-fable-5', name: 'Fable 5', description: '' },
] as ModelOption[]

describe('model fallback row', () => {
  it('names the model that took over with its display name, not its raw id', () => {
    render(
      <ModelFallbackRow
        meta={{ trigger: 'overloaded', fromModel: 'claude-fable-5', toModel: 'claude-opus-5', scope: 'session' }}
        models={CATALOG}
      />,
    )

    expect(screen.getByText('Switched to Opus 5')).toBeInTheDocument()
    expect(screen.getByText('· primary model overloaded')).toBeInTheDocument()
  })

  it('says the response only came from the fallback when the swap was subagent-local', () => {
    render(
      <ModelFallbackRow
        meta={{ trigger: 'refusal', fromModel: 'claude-fable-5', toModel: 'claude-opus-5', scope: 'local' }}
        models={CATALOG}
      />,
    )

    // The session model is unchanged, so this must not read as "switched".
    expect(screen.getByText('This response came from Opus 5')).toBeInTheDocument()
    expect(screen.queryByText('Switched to Opus 5')).not.toBeInTheDocument()
  })

  it('reports a refusal with no fallback as a decline rather than a swap', () => {
    const { container } = render(
      <ModelFallbackRow
        meta={{ trigger: 'refusal', fromModel: 'claude-fable-5', outcome: 'declined', refusalCategory: 'cyber' }}
        models={CATALOG}
      />,
    )

    expect(screen.getByText('Fable 5 declined')).toBeInTheDocument()
    expect(screen.getByText('· no fallback available')).toBeInTheDocument()
    expect(screen.getByText('· cyber')).toBeInTheDocument()
    expect(container.querySelector('[data-model-fallback-outcome="declined"]')).not.toBeNull()
  })

  it('falls back to a generic label when the harness names no target model', () => {
    render(<ModelFallbackRow meta={{ trigger: 'last_resort' }} />)

    expect(screen.getByText('Switched model')).toBeInTheDocument()
    expect(screen.getByText('· no preferred model available')).toBeInTheDocument()
  })

  it('shows an unknown trigger raw instead of a missing translation key', () => {
    render(<ModelFallbackRow meta={{ trigger: 'quota_exhausted', toModel: 'claude-opus-5' }} />)

    expect(screen.getByText('· quota_exhausted')).toBeInTheDocument()
    expect(screen.queryByText(/chat\.modelFallback/)).not.toBeInTheDocument()
  })

  it('right-aligns like the other non-user transcript notices and hides nothing behind hover', () => {
    const { container } = render(
      <ModelFallbackRow meta={{ trigger: 'refusal', fromModel: 'claude-fable-5', toModel: 'claude-opus-5' }} models={CATALOG} />,
    )

    expect(container.querySelector('[data-model-fallback="refusal"]')?.className).toContain('justify-end')
    expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull()
    // The source model is not rendered anywhere, so nothing is hover-only.
    expect(screen.queryByText(/Fable 5/)).not.toBeInTheDocument()
  })
})

describe('resolveModelDisplayName', () => {
  it('prefers the catalog display name', () => {
    expect(resolveModelDisplayName('claude-opus-5', CATALOG)).toBe('Opus 5')
  })

  it('matches a [1m] id against its base catalog entry', () => {
    expect(resolveModelDisplayName('claude-opus-5[1m]', CATALOG)).toBe('Opus 5')
  })

  it('degrades to a shortened id when the catalog has no entry', () => {
    expect(resolveModelDisplayName('claude-haiku-9', CATALOG)).toBe('haiku-9')
  })
})

describe('shortModelName', () => {
  it('strips the vendor prefix and the 1M-context suffix', () => {
    expect(shortModelName('claude-opus-5')).toBe('opus-5')
    expect(shortModelName('claude-sonnet-5[1m]')).toBe('sonnet-5')
  })

  it('returns null for an absent model so callers can pick a generic label', () => {
    expect(shortModelName(undefined)).toBeNull()
  })
})
