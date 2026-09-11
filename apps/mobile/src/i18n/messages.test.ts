import { describe, expect, it } from 'vitest'
import { translateMobileText } from './messages'

describe('mobile translations', () => {
  it('uses desktop title casing for settled English actions', () => {
    expect(translateMobileText('en', 'Add project')).toBe('Add Project')
    expect(translateMobileText('en', 'Search models')).toBe('Search Models')
    expect(translateMobileText('en', 'File actions')).toBe('File Actions')
    expect(translateMobileText('en', 'Search files')).toBe('Search Files')
  })

  it('keeps English progress copy in sentence case', () => {
    expect(translateMobileText('en', 'Loading conversation…')).toBe('Loading conversation…')
  })

  it('translates mobile shell copy into Chinese', () => {
    expect(translateMobileText('zh', 'Language & Region')).toBe('语言与地区')
    expect(translateMobileText('zh', 'No projects yet')).toBe('还没有项目')
    expect(translateMobileText('zh', 'Open workspace, sessions need attention')).toBe('打开工作区，有会话需要关注')
    expect(translateMobileText('zh', 'File actions')).toBe('文件操作')
    expect(translateMobileText('zh', 'Search files')).toBe('搜索文件')
  })
})
