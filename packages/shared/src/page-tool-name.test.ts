import { describe, it, expect } from 'vitest'
import { humanizePageToolName } from './page-tool-name'

describe('humanizePageToolName', () => {
  it('title-cases snake_case and keeps minor words lowercase inside', () => {
    expect(humanizePageToolName('request_switch_to_editor')).toBe('Request Switch to Editor')
    expect(humanizePageToolName('delegate_to_skill')).toBe('Delegate to Skill')
    expect(humanizePageToolName('list_workspace_docs')).toBe('List Workspace Docs')
    expect(humanizePageToolName('read')).toBe('Read')
  })

  it('capitalizes a minor word at either end', () => {
    expect(humanizePageToolName('to_markdown')).toBe('To Markdown')
    expect(humanizePageToolName('search_for')).toBe('Search For')
  })

  it('reads kebab, camel and dotted namespaces too', () => {
    expect(humanizePageToolName('add-todo')).toBe('Add Todo')
    expect(humanizePageToolName('addTodoItem')).toBe('Add Todo Item')
    expect(humanizePageToolName('docs.search')).toBe('Docs Search')
    expect(humanizePageToolName('cart/add_item')).toBe('Cart Add Item')
  })

  it('keeps acronyms upper-case, including the plural form', () => {
    expect(humanizePageToolName('get_html')).toBe('Get HTML')
    expect(humanizePageToolName('copy_url')).toBe('Copy URL')
    expect(humanizePageToolName('list_ids')).toBe('List IDs')
    expect(humanizePageToolName('getHTMLDoc')).toBe('Get HTML Doc')
    expect(humanizePageToolName('export_PDF')).toBe('Export PDF')
  })

  it('passes through what it cannot read instead of blanking the label', () => {
    expect(humanizePageToolName('导出文档')).toBe('导出文档')
    expect(humanizePageToolName('___')).toBe('___')
    expect(humanizePageToolName('  ')).toBe('')
  })

  it('caps a name long enough to push the summary out of the row', () => {
    const label = humanizePageToolName('a_'.repeat(40) + 'end')
    expect(label.length).toBe(49)
    expect(label.endsWith('…')).toBe(true)
  })
})
