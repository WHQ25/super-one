import { describe, expect, it } from 'vitest'
import { translateMobileText } from './messages'

describe('mobile translations', () => {
  it('uses desktop title casing for settled English actions', () => {
    expect(translateMobileText('en', 'Add project')).toBe('Add Project')
    expect(translateMobileText('en', 'Search models')).toBe('Search Models')
  })

  it('keeps English progress copy in sentence case', () => {
    expect(translateMobileText('en', 'Loading conversation…')).toBe('Loading conversation…')
  })

  it('translates mobile shell copy into Chinese', () => {
    expect(translateMobileText('zh', 'Language & Region')).toBe('语言与地区')
    expect(translateMobileText('zh', 'No projects yet')).toBe('还没有项目')
  })
})
