import { execFile } from 'child_process'
import { buildSafeEnv } from './spawn-env'

export function gitRun(folderPath: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: folderPath, env: env ? buildSafeEnv(env) : undefined }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trimEnd())
    })
  })
}
