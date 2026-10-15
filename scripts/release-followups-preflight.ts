import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { parse } from 'yaml'
import { MAC_MANIFEST } from './lib/channels'
import { readR2Object, requireR2Credentials } from './lib/r2'

/** Fail closed before any release publisher can run. The caller checks out the tag. */
function main(): void {
  const [tag, variant] = process.argv.slice(2)
  if (!/^v\d+\.\d+\.\d+(?:-alpha(?:\.\d+)?)?$/.test(tag ?? '')) throw new Error('invalid desktop release tag')
  const version = tag!.slice(1)
  const npmTag = version.includes('-alpha') ? 'alpha' : 'latest'
  if (variant !== (npmTag === 'alpha' ? 'alpha' : 'stable')) throw new Error('desktop tag does not match variant')
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  const sha = git('rev-parse', 'HEAD')
  if (sha !== git('rev-parse', `${tag}^{commit}`)) throw new Error('checkout must match the desktop release tag')
  const release = JSON.parse(execFileSync('gh', [
    'release', 'view', tag!, '--json', 'tagName,isDraft,isPrerelease',
  ], { encoding: 'utf8' }))
  if (release.tagName !== tag || release.isDraft !== false || release.isPrerelease !== (variant === 'alpha')) {
    throw new Error(`${tag} must be published with the matching variant before release follow-ups`)
  }
  requireR2Credentials()
  for (const name of [MAC_MANIFEST, 'latest.yml', 'latest-linux.yml']) {
    const key = `${variant}/${name}`
    const body = readR2Object(key)
    if (body === null || parse(body)?.version !== version) {
      throw new Error(`${key} must point at ${version}; complete desktop set-latest first`)
    }
  }
  const outputs = `version=${version}\nnpm_tag=${npmTag}\nsha=${sha}\n`
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs)
  console.log(`Desktop ${tag} is published on all platforms at ${sha}`)
}

main()
