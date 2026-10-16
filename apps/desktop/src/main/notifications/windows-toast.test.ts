/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { windowsToastXml } from './windows-toast'

function parse(title: string, body: string) {
  const document = new DOMParser().parseFromString(windowsToastXml(title, body), 'application/xml')
  expect(document.querySelector('parsererror')).toBeNull()
  return document
}

describe('compact Windows notification XML', () => {
  it('uses two single-line text elements with no duplicate image or action area', () => {
    const document = parse('VPS · 修复登录', '已完成')
    expect(document.documentElement.tagName).toBe('toast')
    expect(document.documentElement.getAttribute('duration')).toBe('short')
    expect(document.documentElement.hasAttribute('scenario')).toBe(false)
    expect(document.querySelector('binding')?.getAttribute('template')).toBe('ToastGeneric')
    const text = [...document.querySelectorAll('text')]
    expect(text.map(element => element.textContent)).toEqual(['VPS · 修复登录', '已完成'])
    expect(text.every(element => element.getAttribute('hint-maxLines') === '1')).toBe(true)
    expect(document.querySelectorAll('image, actions, action, audio')).toHaveLength(0)
  })

  it('keeps remote titles and status text from injecting XML elements or attributes', () => {
    const title = 'VPS · <actions>"Ship" & \'verify\'</actions>'
    const body = 'Ready > waiting & <input id="bad"/>'
    const document = parse(title, body)
    expect([...document.querySelectorAll('text')].map(element => element.textContent)).toEqual([title, body])
    expect(document.querySelectorAll('actions, input')).toHaveLength(0)
  })

  it('normalizes multiline titles and removes invalid XML controls without losing Unicode', () => {
    const document = parse('  VPS\n\t· 修复\u0000登录 🚀\ufffe  ', '已完成\r\n下一步')
    expect([...document.querySelectorAll('text')].map(element => element.textContent)).toEqual(['VPS · 修复登录 🚀', '已完成 下一步'])
  })
})
