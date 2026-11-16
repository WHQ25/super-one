/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { dismissHarnessScheme, harnessSchemeHold, requestHarnessScheme, resetHarnessSchemeForTests } from './mod-harness-scheme'

afterEach(() => {
  resetHarnessSchemeForTests()
  document.documentElement.classList.remove('dark')
})

describe('mod harness scheme', () => {
  it('holds the document class for the theme scheme and lets it go with the theme', () => {
    requestHarnessScheme('dark')
    expect(harnessSchemeHold()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    requestHarnessScheme(null)
    expect(harnessSchemeHold()).toBeNull()
  })

  it('lets a manual appearance change win until the theme asks for another scheme', () => {
    requestHarnessScheme('dark')
    dismissHarnessScheme()
    expect(harnessSchemeHold()).toBeNull()
    requestHarnessScheme('dark')
    expect(harnessSchemeHold()).toBeNull()
    requestHarnessScheme('light')
    expect(harnessSchemeHold()).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
