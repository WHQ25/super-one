import { describe, expect, it } from 'vitest'
import { isModelOnlyHostWake } from './host-wake'

describe('isModelOnlyHostWake', () => {
  it.each([
    '<task_notification source="browser_download" task_id="bdl_1" status="failed">\nerror: x\n</task_notification>',
    '<task_notification source="artifact_sync" status="completed">\n- "/tmp/a"\n</task_notification>',
    'A collaboration mailbox message is ready. It is from SuperOne session p ("P").',
    '  A user-approved collaboration link is active with SuperOne session p ("P").',
  ])('matches a host receipt or mailbox wake: %s', (text) => {
    expect(isModelOnlyHostWake(text)).toBe(true)
  })

  it.each([
    '/pr-babysit check',
    'The background download has completed.',
    'Why did I get <task_notification source="browser_download"> in chat?',
    '<task_notification source="other" status="completed">',
  ])('leaves other text visible: %s', (text) => {
    expect(isModelOnlyHostWake(text)).toBe(false)
  })
})
