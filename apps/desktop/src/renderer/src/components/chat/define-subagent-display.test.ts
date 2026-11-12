import { describe, expect, it } from 'vitest'
import { defineSubagentSummaryText, parseDefineSubagent } from './define-subagent-display'

describe('parseDefineSubagent', () => {
  it('parses PascalCase and normalized fields along with confirmation output', () => {
    const info = parseDefineSubagent(
      {
        Name: 'db-migrator',
        Description: 'Executes schema migrations safely',
        SystemPrompt: 'Always run inside a transaction.',
        EnableWriteTools: 'true',
        EnableMCPTools: false,
        EnableSubagentTools: true,
      },
      'Subagent "db-migrator" defined successfully. It can now be invoked via invoke_subagent.',
    )
    expect(info.name).toBe('db-migrator')
    expect(info.description).toBe('Executes schema migrations safely')
    expect(info.systemPrompt).toBe('Always run inside a transaction.')
    expect(info.enableWriteTools).toBe(true)
    expect(info.enableMcpTools).toBe(false)
    expect(info.enableSubagentTools).toBe(true)
    expect(info.confirmedDefined).toBe(true)
    expect(defineSubagentSummaryText({ name: 'db-migrator', description: 'Executes schema migrations safely' })).toBe(
      'db-migrator · Executes schema migrations safely',
    )
  })

  it('recovers subagent name from confirmation text when input is sparse', () => {
    const info = parseDefineSubagent(
      {},
      'Subagent "security-auditor" defined successfully. It can now be invoked via invoke_subagent.',
    )
    expect(info.name).toBe('security-auditor')
    expect(info.confirmedDefined).toBe(true)
  })
})
