import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE } from './antigravity-site-customize'

export { ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE }

const PYVENV_CFG_CONTENT = 'include-system-site-packages = true\n'

const SITE_CUSTOMIZE_DIRS = [
  ['lib', 'python3.12', 'site-packages'],
  ['lib', 'python3.13', 'site-packages'],
  ['lib', 'python3.14', 'site-packages'],
  ['lib', 'python3.15', 'site-packages'],
  ['Lib', 'site-packages'],
] as const

function writeFileIfChanged(filePath: string, content: string): void {
  try {
    if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) {
      return
    }
  } catch {
    void 0
  }
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  writeFileSync(filePath, content, { mode: 0o600 })
}

function populateVenvSiteCustomize(sitePrefixDir: string): void {
  mkdirSync(sitePrefixDir, { recursive: true, mode: 0o700 })
  writeFileIfChanged(join(sitePrefixDir, 'pyvenv.cfg'), PYVENV_CFG_CONTENT)
  for (const parts of SITE_CUSTOMIZE_DIRS) {
    writeFileIfChanged(join(sitePrefixDir, ...parts, 'sitecustomize.py'), ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE)
  }
}

export function ensureAntigravityAutoBootstrap(
  antigravityRoot: string,
  harnessPath?: string,
): {
  bootstrapDir: string
  pyvenvLauncherPath: string
} {
  const bootstrapDir = join(antigravityRoot, 'bootstrap')
  const binDir = join(bootstrapDir, 'bin')
  mkdirSync(binDir, { recursive: true, mode: 0o700 })
  populateVenvSiteCustomize(bootstrapDir)

  if (harnessPath) {
    const versionDir = dirname(harnessPath)
    const versionsParentDir = dirname(versionDir)
    if (basename(versionsParentDir) === 'versions') {
      try {
        populateVenvSiteCustomize(versionsParentDir)
      } catch {
        void 0
      }
    }
  }

  return {
    bootstrapDir,
    pyvenvLauncherPath: join(binDir, 'python3'),
  }
}
