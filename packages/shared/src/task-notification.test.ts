import { describe, expect, it } from 'vitest'
import { usefulTaskNotificationSummary } from './task-notification'

describe('usefulTaskNotificationSummary', () => {
  it('drops empty or whitespace-only summaries', () => {
    expect(usefulTaskNotificationSummary(undefined, 'watch')).toBeUndefined()
    expect(usefulTaskNotificationSummary('   ', 'watch')).toBeUndefined()
  })

  it('drops a summary that restates the task title', () => {
    expect(
      usefulTaskNotificationSummary(
        'Inspect what the domain currently serves',
        'Inspect what the domain currently serves',
      ),
    ).toBeUndefined()
    expect(
      usefulTaskNotificationSummary(
        '  inspect what the domain currently serves  ',
        'Inspect what the domain currently serves',
      ),
    ).toBeUndefined()
  })

  it('drops status words the row label already shows', () => {
    expect(usefulTaskNotificationSummary('completed', 'watch')).toBeUndefined()
    expect(usefulTaskNotificationSummary('FAILED', undefined)).toBeUndefined()
    expect(usefulTaskNotificationSummary('stopped', undefined)).toBeUndefined()
  })

  it('keeps an outcome that is not the title or a status word', () => {
    expect(usefulTaskNotificationSummary('exit 0', 'watch')).toBe('exit 0')
    expect(
      usefulTaskNotificationSummary(
        '  watcher exited before the run finished  ',
        'gh run watch --exit-status',
      ),
    ).toBe('watcher exited before the run finished')
  })
})
