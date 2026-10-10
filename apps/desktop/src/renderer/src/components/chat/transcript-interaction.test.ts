/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { transcriptInteractionSnapshot } from './transcript-interaction'

afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.innerHTML = ''; vi.restoreAllMocks() })

it('pins selected, focused and playing content with one selection read per batch', () => {
  document.body.innerHTML = '<div id="selected">Selected text</div><div id="focused"><button>Focus</button></div><div id="playing"><video></video></div><div id="other">Other text</div>'
  document.querySelector('button')!.focus()
  const range = document.createRange()
  range.selectNodeContents(document.querySelector('#selected')!)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  Object.defineProperty(document.querySelector('video'), 'paused', { value: false })
  const selection = vi.spyOn(document, 'getSelection')
  const hasInteraction = transcriptInteractionSnapshot(document)
  expect(hasInteraction(document.querySelector('#selected')!)).toBe(true)
  expect(hasInteraction(document.querySelector('#focused')!)).toBe(true)
  expect(hasInteraction(document.querySelector('#playing')!)).toBe(true)
  for (let index = 0; index < 1000; index++) expect(hasInteraction(document.querySelector('#other')!)).toBe(false)
  expect(selection).toHaveBeenCalledTimes(1)
})
