import { describe, expect, it } from 'vitest'
import { getPermissionPromptConfig } from './permission-prompt-config'

describe('getPermissionPromptConfig', () => {
  it('gives Codex its four-button decision row when it offers to persist', () => {
    expect(getPermissionPromptConfig('codex', true, false)).toEqual({
      buttonCount: 4,
      includesFeedbackOnDeny: false,
      enterSubmitsFeedback: false,
    })
  })

  it('keeps the device grant on its own three-button row even under Codex', () => {
    // The trap this guards: the device confirm sets `allowAlwaysAllow`, which is
    // exactly the condition that selects Codex's layout. That layout would relabel
    // "always allow" as "allow for this session" — which is what the device prompt's
    // PLAIN allow already means — and drop the deny feedback the device tool reads
    // back to the agent.
    const config = getPermissionPromptConfig('codex', true, false, 'device_control_confirm')

    expect(config.buttonCount).toBe(3)
    expect(config.includesFeedbackOnDeny).toBe(true)
    expect(config.enterSubmitsFeedback).toBe(true)
  })

  it('renders the same device row on every other harness', () => {
    expect(getPermissionPromptConfig('claude', true, false, 'device_control_confirm'))
      .toEqual(getPermissionPromptConfig('codex', true, false, 'device_control_confirm'))
  })

  it('leaves an ordinary two-button prompt alone', () => {
    expect(getPermissionPromptConfig('claude', false, false)).toEqual({
      buttonCount: 2,
      includesFeedbackOnDeny: true,
      enterSubmitsFeedback: true,
    })
  })
})
