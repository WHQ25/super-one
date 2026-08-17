/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { brandKeyForCatalogProvider, ProviderLabel } from './ProviderLabel'

describe('ProviderLabel', () => {
  it('uses the Cursor mark instead of the globe fallback', () => {
    const { container } = render(<ProviderLabel brandKey="cursor" iconOnly size={26} />)
    expect(container.querySelector('.lucide-globe')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('matches built-in provider sizing for compact custom-provider labels', () => {
    const { container } = render(
      <ProviderLabel brandKey="custom" fallback="AIYun Router Codex" size={12} compactFallback />,
    )

    expect(screen.getByText('AIYun Router Codex')).toHaveStyle({ fontSize: '9px' })
    expect(container.querySelector('svg')).toHaveStyle({ width: '12px', height: '12px' })
  })
})

describe('brandKeyForCatalogProvider', () => {
  it('keeps catalog ids that already match a brand key', () => {
    expect(brandKeyForCatalogProvider('openai')).toBe('openai')
    expect(brandKeyForCatalogProvider('anthropic')).toBe('anthropic')
    expect(brandKeyForCatalogProvider('deepseek')).toBe('deepseek')
  })

  it('maps models.dev ids onto the closest brand icon', () => {
    expect(brandKeyForCatalogProvider('zhipuai')).toBe('zhipu')
    expect(brandKeyForCatalogProvider('moonshotai')).toBe('moonshot')
    expect(brandKeyForCatalogProvider('alibaba')).toBe('bailian')
  })

  it('returns undefined for unknown or empty providers', () => {
    expect(brandKeyForCatalogProvider('unknown-vendor')).toBeUndefined()
    expect(brandKeyForCatalogProvider(undefined)).toBeUndefined()
  })
})
