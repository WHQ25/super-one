import { describe, it, expect } from 'vitest'
import { generateVanillaFiles, generateReactFiles, generateSuperoneDts, slugify } from './miniapp-templates'
import type { TemplateOptions } from './miniapp-templates'
import type { MiniAppManifest } from '@superone/shared/miniapp-types'

function makeOpts(overrides?: Partial<TemplateOptions>): TemplateOptions {
  const manifest: MiniAppManifest = {
    appId: 'test-app',
    name: 'Test App',
  }
  return {
    name: 'Test App',
    manifest,
    ...overrides,
  }
}

describe('generateVanillaFiles', () => {
  it('generates 2 files', () => {
    const files = generateVanillaFiles(makeOpts())
    expect(files).toHaveLength(2)
    expect(files.map((f) => f.path)).toEqual(['manifest.json', 'index.html'])
  })

  it('generates valid manifest JSON', () => {
    const files = generateVanillaFiles(makeOpts())
    const manifest = JSON.parse(files[0].content)
    expect(manifest.appId).toBe('test-app')
    expect(manifest.name).toBe('Test App')
  })

  it('generates clean HTML without tool handlers', () => {
    const files = generateVanillaFiles(makeOpts())
    const html = files[1].content
    expect(html).toContain('<div id="output"></div>')
    expect(html).not.toContain('superone.tools.handle')
  })

  it('uses CSS variables for theming', () => {
    const files = generateVanillaFiles(makeOpts())
    const html = files[1].content
    expect(html).toContain('var(--background')
    expect(html).toContain('var(--foreground')
    expect(html).toContain('var(--card')
  })
})

describe('generateReactFiles', () => {
  it('generates ~10 files', () => {
    const files = generateReactFiles(makeOpts())
    expect(files.length).toBeGreaterThanOrEqual(10)
  })

  it('generates correct file paths', () => {
    const files = generateReactFiles(makeOpts())
    const paths = files.map((f) => f.path)
    expect(paths).toContain('public/manifest.json')
    expect(paths).toContain('package.json')
    expect(paths).toContain('vite.config.ts')
    expect(paths).toContain('tsconfig.json')
    expect(paths).toContain('index.html')
    expect(paths).toContain('src/main.tsx')
    expect(paths).toContain('src/App.tsx')
    expect(paths).toContain('src/superone.d.ts')
    expect(paths).toContain('src/index.css')
    expect(paths).toContain('.gitignore')
  })

  it('places manifest in public/', () => {
    const files = generateReactFiles(makeOpts())
    const manifestFile = files.find((f) => f.path === 'public/manifest.json')!
    const manifest = JSON.parse(manifestFile.content)
    expect(manifest.appId).toBe('test-app')
  })

  it('vite.config has base ./', () => {
    const files = generateReactFiles(makeOpts())
    const viteConfig = files.find((f) => f.path === 'vite.config.ts')!
    expect(viteConfig.content).toContain("base: './'")
  })

  it('vite.config includes react and tailwind plugins', () => {
    const files = generateReactFiles(makeOpts())
    const viteConfig = files.find((f) => f.path === 'vite.config.ts')!
    expect(viteConfig.content).toContain("import react from '@vitejs/plugin-react'")
    expect(viteConfig.content).toContain("import tailwindcss from '@tailwindcss/vite'")
    expect(viteConfig.content).toContain('plugins: [react(), tailwindcss()]')
  })

  it('package.json has correct dependencies', () => {
    const files = generateReactFiles(makeOpts())
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content)
    expect(pkg.dependencies.react).toBeDefined()
    expect(pkg.dependencies['react-dom']).toBeDefined()
    expect(pkg.devDependencies.vite).toBeDefined()
    expect(pkg.devDependencies.typescript).toBeDefined()
    expect(pkg.devDependencies.tailwindcss).toBeDefined()
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeDefined()
    expect(pkg.devDependencies['@tailwindcss/vite']).toBeDefined()
  })

  it('package.json has build and dev scripts', () => {
    const files = generateReactFiles(makeOpts())
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content)
    expect(pkg.scripts.build).toBe('vite build')
    expect(pkg.scripts.dev).toBe('vite')
  })

  it('App.tsx is a clean component without tool handlers', () => {
    const files = generateReactFiles(makeOpts())
    const app = files.find((f) => f.path === 'src/App.tsx')!
    expect(app.content).toContain('Test App')
    expect(app.content).not.toContain('window.superone.tools.handle')
  })

  it('index.css imports tailwindcss', () => {
    const files = generateReactFiles(makeOpts())
    const css = files.find((f) => f.path === 'src/index.css')!
    expect(css.content).toContain('@import "tailwindcss"')
  })

  it('generates dist/ placeholder with manifest and index.html', () => {
    const files = generateReactFiles(makeOpts())
    const paths = files.map((f) => f.path)
    expect(paths).toContain('dist/manifest.json')
    expect(paths).toContain('dist/index.html')
  })

  it('dist/manifest.json matches public/manifest.json', () => {
    const files = generateReactFiles(makeOpts())
    const pubManifest = files.find((f) => f.path === 'public/manifest.json')!
    const distManifest = files.find((f) => f.path === 'dist/manifest.json')!
    expect(distManifest.content).toBe(pubManifest.content)
  })
})

describe('generateVanillaFiles (in-chat)', () => {
  function makeInChatOpts(): TemplateOptions {
    const manifest: MiniAppManifest = {
      appId: 'daily-report',
      name: 'Daily Report',
      type: 'in-chat',
      inChatToolName: 'render_report',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    }
    return { name: 'Daily Report', manifest }
  }

  it('generates in-chat template with onInit', () => {
    const files = generateVanillaFiles(makeInChatOpts())
    expect(files).toHaveLength(2)
    const html = files[1].content
    expect(html).toContain('superone.onInit')
    expect(html).not.toContain('superone.tools.handle')
  })

  it('uses transparent background', () => {
    const files = generateVanillaFiles(makeInChatOpts())
    const html = files[1].content
    expect(html).toContain('background: transparent')
  })
})

describe('generateSuperoneDts', () => {
  const dts = generateSuperoneDts()

  it('declares window.superone', () => {
    expect(dts).toContain('interface Window')
    expect(dts).toContain('superone: SuperOne')
  })

  it('covers tools API', () => {
    expect(dts).toContain('handle(name: string')
  })

  it('covers onInit API', () => {
    expect(dts).toContain('onInit(callback:')
  })

  it('covers fs API', () => {
    expect(dts).toContain('readFile(path: string): Promise<string>')
    expect(dts).toContain("readFile(path: string, opts: { binary: true }): Promise<ArrayBuffer>")
    expect(dts).toContain('writeFile(path: string, content: string | ArrayBuffer | Uint8Array): Promise<void>')
    expect(dts).toContain('deleteFile(path: string): Promise<void>')
    expect(dts).toContain('rename(from: string, to: string): Promise<void>')
    expect(dts).toContain('stat(path: string): Promise<SuperOneFsStat>')
    expect(dts).toContain('mkdir(path: string): Promise<void>')
    expect(dts).toContain('readDir(path?: string): Promise<SuperOneFsEntry[]>')
    expect(dts).toContain('glob(pattern: string): Promise<string[]>')
    expect(dts).toContain('watch(path: string')
    expect(dts).toContain('unwatch(watchId: number): void')
  })

  it('covers git API', () => {
    expect(dts).toContain('info(): Promise<SuperOneGitInfo>')
    expect(dts).toContain('branches(): Promise<string[]>')
    expect(dts).toContain('log(opts?: { limit?: number; all?: boolean; ref?: string })')
    expect(dts).toContain('status(): Promise<SuperOneGitStatusEntry[]>')
    expect(dts).toContain('diff(path: string')
    expect(dts).toContain('show(ref: string')
    expect(dts).toContain('blame(path: string): Promise<SuperOneGitBlameLine[]>')
    expect(dts).toContain('diffSummary(ref1: string, ref2?: string): Promise<SuperOneGitDiffFile[]>')
    expect(dts).toContain('getCommit(ref?: string): Promise<SuperOneGitCommit>')
    expect(dts).toContain('tags(): Promise<SuperOneGitTag[]>')
    expect(dts).toContain('remotes(): Promise<SuperOneGitRemote[]>')
    expect(dts).toContain('branchDetail(name: string): Promise<SuperOneGitBranchDetail>')
    expect(dts).toContain('stashList(): Promise<SuperOneGitStashEntry[]>')
    expect(dts).toContain('logFile(path: string, opts?: { limit?: number }): Promise<SuperOneGitLogEntry[]>')
    expect(dts).toContain('onHeadChange(callback: () => void): () => void')
  })

  it('covers agent API', () => {
    expect(dts).toContain('sendPrompt(text: string): void')
  })

  it('covers system API', () => {
    expect(dts).toContain('openFolder(path: string): void')
    expect(dts).toContain('openExternalLink(url: string): void')
    expect(dts).toContain('read(): Promise<string>')
    expect(dts).toContain('write(text: string): void')
  })

  it('covers ui API', () => {
    expect(dts).toContain('toast(message: string')
    expect(dts).toContain('showTooltip(anchorRect:')
    expect(dts).toContain('hideTooltip(): void')
    expect(dts).toContain('showContextMenu(position:')
  })

  it('covers theme API', () => {
    expect(dts).toContain('getVars(): SuperOneThemeVars')
    expect(dts).toContain('onChange(callback: (vars: SuperOneThemeVars)')
  })

  it('covers dark mode API', () => {
    expect(dts).toContain('isDarkMode(): boolean')
    expect(dts).toContain('onDarkModeChange(callback: (isDark: boolean)')
  })
})

describe('slugify', () => {
  it('converts name to kebab-case', () => {
    expect(slugify('My Cool App')).toBe('my-cool-app')
  })

  it('removes special characters', () => {
    expect(slugify('App (v2)!')).toBe('app-v2')
  })

  it('handles already kebab-case', () => {
    expect(slugify('my-app')).toBe('my-app')
  })
})
