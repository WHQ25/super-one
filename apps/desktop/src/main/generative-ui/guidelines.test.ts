import { describe, it, expect } from 'vitest'
import { NATIVE_WIDGET_TYPES } from '@superone/shared/generative-ui/native-widgets'
import { AVAILABLE_MODULES, getGuidelines } from './guidelines'
import { NATIVE_TEMPLATE_CATALOG } from './native-widget-payload'

describe('the native UI widget module', () => {
  it('is offered as a module, so it can be requested like any other', () => {
    expect(AVAILABLE_MODULES).toContain('native')
  })

  it('names every template the catalog actually serves', () => {
    // The module teaches when to reach for a native surface; widget_list_templates is authoritative
    // for the data shape. If a template is added to one and not the other, the agent is told about
    // a template it cannot call, or never hears about one it can.
    const text = getGuidelines(['native'])
    for (const { id } of NATIVE_TEMPLATE_CATALOG) expect(text, id).toContain(id)
  })

  it('covers every native widget type, so a new surface cannot ship undocumented', () => {
    const text = getGuidelines(['native'])
    for (const type of NATIVE_WIDGET_TYPES) expect(text, type).toContain(`@native/${type}`)
  })

  it('skips the HTML design system, which does not apply when you author no markup', () => {
    const text = getGuidelines(['native'])
    expect(text).not.toContain('## Core Design System')
    expect(text).not.toContain('## Color palette')
  })

  it('is advertised in the shared module list every other module also loads', () => {
    // Discovery matters more here than for the design modules: an agent about to hand-write a
    // gallery has no reason to guess that a native surface exists.
    for (const module of AVAILABLE_MODULES) {
      expect(getGuidelines([module]), module).toContain('native')
    }
  })
})
