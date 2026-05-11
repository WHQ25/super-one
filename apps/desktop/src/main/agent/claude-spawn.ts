import { spawn, type StdioOptions } from 'child_process'
import type { SpawnOptions as SdkSpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'
import { ProcessTitle } from '../process-titles'

export function makeClaudeSpawn(opts?: { onStderr?: (data: string) => void }) {
  return (sdkOpts: SdkSpawnOptions): SpawnedProcess => {
    const wantStderr = !!opts?.onStderr || !!sdkOpts.env.DEBUG_CLAUDE_AGENT_SDK
    const stdio: StdioOptions = ['pipe', 'pipe', wantStderr ? 'pipe' : 'ignore']
    const proc = spawn(sdkOpts.command, sdkOpts.args, {
      cwd: sdkOpts.cwd,
      stdio,
      signal: sdkOpts.signal,
      env: sdkOpts.env,
      windowsHide: true,
      argv0: ProcessTitle.Claude,
    })
    if (opts?.onStderr) {
      proc.stderr?.on('data', (chunk) => opts.onStderr!(String(chunk)))
    }
    return proc as unknown as SpawnedProcess
  }
}
