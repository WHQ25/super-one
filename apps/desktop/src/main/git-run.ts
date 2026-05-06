import { execFile } from 'child_process'

export function gitRun(folderPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: folderPath }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trimEnd())
    })
  })
}
