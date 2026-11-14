import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const ssh = vi.hoisted(() => ({
  uploads: [] as { remotePath: string; remoteCommand: string }[],
  commands: [] as string[],
}))
const variant = vi.hoisted(() => ({ id: 'dev' as 'stable' | 'alpha' | 'dev' }))
vi.mock('../variant', () => ({ variantId: () => variant.id }))
vi.mock('./ssh-forward', () => ({
  sshUpload: async (opts: { remotePath: string; remoteCommand: string }) => {
    ssh.uploads.push(opts)
  },
  sshCapture: async (opts: { command: string }) => {
    ssh.commands.push(opts.command)
    return { code: 0, stdout: 'SUPERONE_REGISTRY_OK=/home/u/.superone/dev/npm/bin/superone\n', stderr: '' }
  },
}))

import { installNodeFromPackage, installNodeFromRegistry } from './remote-install'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  ssh.uploads.length = 0
  ssh.commands.length = 0
  variant.id = 'dev'
})

it('installs an uploaded dev package into the dev prefix only after its checksum matches', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-pkg-'))
  dirs.push(dir)
  const tarballPath = join(dir, 'super-one-cli-1.2.3.tgz')
  writeFileSync(tarballPath, 'package bytes')

  const result = await installNodeFromPackage({
    destination: 'u@lab',
    tarballPath,
    version: '1.2.3',
    remoteHome: '/home/u',
  })

  const uploadPath = '/home/u/.superone/dev/downloads/super-one-cli-1.2.3.tgz'
  expect(ssh.uploads.map((u) => u.remotePath)).toEqual([uploadPath])
  const command = ssh.commands[0]!
  const checksum = command.indexOf('remote_sha=')
  const install = command.indexOf(`npm install -g --engine-strict --prefix /home/u/.superone/dev/npm ${uploadPath}`)
  expect(checksum).toBeGreaterThanOrEqual(0)
  expect(install).toBeGreaterThan(checksum)
  expect(command).toContain('/home/u/.local/bin/superone-dev')
  // Removed after the chain, whether or not npm succeeded, keeping its status.
  expect(command).toContain(`; rc=$?; rm -f ${uploadPath}; exit $rc`)
  expect(command).not.toContain('.superone/alpha')
  expect(result).toMatchObject({ remoteExec: '/home/u/.superone/dev/npm/bin/superone', source: 'upload', version: '1.2.3' })
})

it('refuses a registry install on the dev channel', async () => {
  await expect(installNodeFromRegistry({ destination: 'u@lab', version: '1.2.3-alpha.1', remoteHome: '/home/u' }))
    .rejects.toThrow(/dev node channel/)
  expect(ssh.commands).toEqual([])
})

it.each([
  ['alpha', '1.2.3'],
  ['stable', '1.2.3-alpha.1'],
] as const)('refuses a registry version from another channel on a %s desktop', async (id, version) => {
  variant.id = id
  await expect(installNodeFromRegistry({ destination: 'u@lab', version, remoteHome: '/home/u' }))
    .rejects.toThrow(`does not belong to the ${id} node channel`)
  expect(ssh.commands).toEqual([])
})
