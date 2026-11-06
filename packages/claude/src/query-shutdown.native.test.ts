import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { ClaudeLiveSession } from './claude-live-session'

describe.skipIf(process.env.SUPERONE_TEST_CLAUDE_NATIVE !== '1')('SDK subprocess exit draining', () => {
  it('drains the EOF-only warning after a completed turn with bidirectional callbacks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-eof-'))
    const binary = join(dir, 'fake-claude')
    writeFileSync(binary, `#!${process.execPath}
const lines = require('node:readline').createInterface({input: process.stdin});
lines.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.type === 'control_request') process.stdout.write(JSON.stringify({type:'control_response', response:{subtype:'success', request_id:msg.request_id, response:{commands:[],models:[],account:{},capabilities:[],hook_on_failure_supported:true}}})+'\\n');
  if (msg.type === 'user') process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:'s',result:'done',session_state:'idle'})+'\\n');
});
lines.on('close', () => {
  process.stdout.write(JSON.stringify({type:'system',subtype:'session_writes_lost',uuid:'00000000-0000-0000-0000-000000000001',session_id:'s',error_code:'EDQUOT',lost:['transcript']})+'\\n');
});
`)
    chmodSync(binary, 0o755)
    const events: AgentEvent[] = []
    const stderr: string[] = []
    const live = ClaudeLiveSession.open({ cwd: dir, binaryPath: binary,
      onAmbientEvent: event => events.push(event), options: { settingSources: [], stderr: data => stderr.push(data) } })
    try {
      await live.query!.initializationResult().catch(error => { throw new Error(`${error}: ${stderr.join('')}`) })
      // t > 0 plus live's canUseTool/Stop hook exercises SDK waitForRunEnd.
      await expect(live.sendTurn({ content: 'one turn' })).resolves.toMatchObject({ finalText: 'done' })
      await live.dispose()
      expect(events).toContainEqual(expect.objectContaining({ type: 'user_message_appended', message: expect.objectContaining({
        metadata: { systemNotice: expect.objectContaining({ code: 'EDQUOT' }) },
      }) }))
    } finally { await live.dispose(); rmSync(dir, { recursive: true, force: true }) }
  }, 10_000)
})
