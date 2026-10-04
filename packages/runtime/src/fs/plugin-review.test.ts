import { expect, it } from 'vitest'
import { parsePluginValidateReport } from './plugin-review'

// Recorded from claude 2.1.287 on the official blast-radius sample.
const BLAST_RADIUS = {
  success: true,
  strict: false,
  manifest: { file: '/p/.claude-plugin/plugin.json', type: 'plugin', errors: [], warnings: [], notes: [] },
  contents: [{
    file: '/p/hooks/hooks.json',
    type: 'hooks',
    errors: [],
    warnings: [],
    notes: [
      './blast-radius.mjs hooks: tool.call{tool=Bash}, ui.render{component=Pane}, ui.render{component=AbovePrompt}',
      './blast-radius.mjs calls: $.clock.now, $.process.run, $.session.cwd, $.ui.close, $.ui.invalidate, $.ui.open, $.ui.resolve, $.ui.toast',
    ],
  }],
}

it('lists each module’s hooks and calls and flags approval bypass', () => {
  const review = parsePluginValidateReport(BLAST_RADIUS)
  expect(review.ok).toBe(true)
  expect(review.modules).toEqual([{
    module: './blast-radius.mjs',
    hooks: ['tool.call{tool=Bash}', 'ui.render{component=Pane}', 'ui.render{component=AbovePrompt}'],
    calls: ['$.clock.now', '$.process.run', '$.session.cwd', '$.ui.close', '$.ui.invalidate', '$.ui.open', '$.ui.resolve', '$.ui.toast'],
  }])
  expect(review.flags).toEqual(['tool-approval'])
})

it('keeps matcher commas inside braces and flags prompt.submit', () => {
  const review = parsePluginValidateReport({ success: true, contents: [{ notes: ['m.mjs hooks: prompt.submit, ui.render{component=Pane, surface=desktop}'] }] })
  expect(review.modules[0]!.hooks).toEqual(['prompt.submit', 'ui.render{component=Pane, surface=desktop}'])
  expect(review.flags).toEqual(['prompt-submit'])
})

it('reports errors and an unknown shape without throwing', () => {
  expect(parsePluginValidateReport({ success: false, contents: [{ errors: ['bad hooks.json'], warnings: [{ message: 'unknown field' }] }] }))
    .toEqual({ ok: false, modules: [], flags: [], errors: ['bad hooks.json'], warnings: ['unknown field'] })
  expect(parsePluginValidateReport(null).ok).toBe(false)
})
