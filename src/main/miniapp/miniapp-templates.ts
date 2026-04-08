import type { MiniAppManifest } from '../../shared/miniapp-types'

export interface GeneratedFile {
  path: string
  content: string
}

export interface TemplateOptions {
  name: string
  manifest: MiniAppManifest
}

export function generateVanillaFiles(opts: TemplateOptions): GeneratedFile[] {
  const html = opts.manifest.type === 'in-chat'
    ? generateInChatVanillaHtml(opts.name)
    : generateVanillaHtml(opts.name)
  return [
    { path: 'manifest.json', content: JSON.stringify(opts.manifest, null, 2) },
    { path: 'index.html', content: html },
  ]
}

export function generateReactFiles(opts: TemplateOptions): GeneratedFile[] {
  const placeholderHtml = generatePlaceholderHtml(opts.name)
  const files: GeneratedFile[] = [
    { path: 'public/manifest.json', content: JSON.stringify(opts.manifest, null, 2) },
    { path: 'package.json', content: generatePackageJson(opts.name) },
    { path: 'vite.config.ts', content: generateViteConfig() },
    { path: 'tsconfig.json', content: generateTsconfig() },
    { path: 'index.html', content: generateReactEntryHtml(opts.name) },
    { path: 'src/main.tsx', content: generateReactMain() },
    { path: 'src/App.tsx', content: generateReactApp(opts.name) },
    { path: 'src/superone.d.ts', content: generateSuperoneDts() },
    { path: 'src/index.css', content: '@import "tailwindcss";\n' },
    { path: '.gitignore', content: 'node_modules\ndist\n' },
    { path: 'dist/manifest.json', content: JSON.stringify(opts.manifest, null, 2) },
    { path: 'dist/index.html', content: placeholderHtml },
  ]
  return files
}

function generatePlaceholderHtml(name: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, sans-serif;
      padding: 24px;
      background: var(--background, #fafaf9);
      color: var(--foreground, #1c1917);
    }
    h1 { font-size: 20px; margin-bottom: 16px; }
    p { color: var(--muted-foreground, #78716c); font-size: 14px; }
  </style>
</head>
<body>
  <h1>${name}</h1>
  <p>Run <code>bun run build</code> to see the React app.</p>
</body>
</html>`
}

function generateVanillaHtml(name: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, sans-serif;
      padding: 24px;
      background: var(--background, #fafaf9);
      color: var(--foreground, #1c1917);
    }
    h1 { font-size: 20px; margin-bottom: 16px; }
    #output { display: flex; flex-direction: column; gap: 8px; }
    .msg {
      background: var(--card, #fff);
      border: 1px solid var(--border, #e7e5e4);
      border-radius: 8px;
      padding: 12px;
      white-space: pre-wrap;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <h1>${name}</h1>
  <div id="output"></div>
</body>
</html>`
}

function generateInChatVanillaHtml(name: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, sans-serif;
      padding: 16px;
      background: transparent;
      color: var(--foreground, #1c1917);
    }
    .card {
      background: var(--card, #fff);
      border: 1px solid var(--border, #e7e5e4);
      border-radius: 8px;
      padding: 16px;
    }
    h2 { font-size: 16px; margin-bottom: 12px; }
    pre { font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    superone.onInit(function(data) {
      var root = document.getElementById('root');
      root.innerHTML = '<div class="card"><h2>${name}</h2><pre>' +
        JSON.stringify(data, null, 2) + '</pre></div>';
    });
  </script>
</body>
</html>`
}

function generatePackageJson(name: string): string {
  const pkg = {
    name: slugify(name),
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
    },
    dependencies: {
      react: '^19.1.0',
      'react-dom': '^19.1.0',
    },
    devDependencies: {
      '@tailwindcss/vite': '^4.1.8',
      '@types/react': '^19.1.6',
      '@types/react-dom': '^19.1.6',
      '@vitejs/plugin-react': '^4.5.2',
      tailwindcss: '^4.1.8',
      typescript: '^5.8.3',
      vite: '^6.3.5',
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

function generateViteConfig(): string {
  const lines = [
    "import { defineConfig } from 'vite'",
    "import react from '@vitejs/plugin-react'",
    "import tailwindcss from '@tailwindcss/vite'",
    '',
    'export default defineConfig({',
    "  plugins: [react(), tailwindcss()],",
    "  base: './',",
    "  build: { outDir: 'dist' },",
    '})',
    '',
  ]
  return lines.join('\n')
}

function generateTsconfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: 'dist',
    },
    include: ['src'],
  }
  return JSON.stringify(config, null, 2) + '\n'
}

function generateReactEntryHtml(name: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`
}

function generateReactMain(): string {
  const lines = [
    "import { StrictMode } from 'react'",
    "import { createRoot } from 'react-dom/client'",
    "import App from './App'",
    "import './index.css'",
    '',
    "createRoot(document.getElementById('root')!).render(",
    '  <StrictMode>',
    '    <App />',
    '  </StrictMode>,',
    ')',
    '',
  ]
  return lines.join('\n')
}

function generateReactApp(name: string): string {
  return `function App() {
  return (
    <div className="p-6 font-sans">
      <h1 className="text-xl font-bold mb-4">${name}</h1>
    </div>
  )
}

export default App
`
}

export function generateSuperoneDts(): string {
  return `interface SuperOneFsEntry {
  name: string
  isDir: boolean
}

interface SuperOneFsWatchEvent {
  type: 'change' | 'rename'
  path: string
}

interface SuperOneGitInfo {
  branch: string
  dirty?: { files: number; insertions: number; deletions: number }
}

interface SuperOneGitLogEntry {
  sha: string
  parents: string[]
  message: string
  author: string
  date: string
}

interface SuperOneGitStatusEntry {
  path: string
  status: string
  staged: boolean
}

interface SuperOneGitDiff {
  path: string
  diff: string
}

interface SuperOneGitShow {
  ref: string
  path: string
  content: string
}

interface SuperOneThemeVars {
  [key: string]: string
}

interface SuperOne {
  tools: {
    handle(name: string, callback: (args: Record<string, unknown>) => unknown | Promise<unknown>): void
  }
  onInit(callback: (data: Record<string, unknown>) => void): void
  fs: {
    readFile(path: string): Promise<string>
    readDir(path?: string): Promise<SuperOneFsEntry[]>
    writeFile(path: string, content: string): Promise<void>
    exists(path: string): Promise<boolean>
    glob(pattern: string): Promise<string[]>
    watch(path: string, callback: (event: SuperOneFsWatchEvent) => void): Promise<number>
    unwatch(watchId: number): void
  }
  agent: {
    sendPrompt(text: string): void
  }
  git: {
    info(): Promise<SuperOneGitInfo>
    branches(): Promise<string[]>
    log(opts?: { limit?: number }): Promise<SuperOneGitLogEntry[]>
    status(): Promise<SuperOneGitStatusEntry[]>
    diff(path: string, staged?: boolean): Promise<SuperOneGitDiff>
    show(ref: string, path: string): Promise<SuperOneGitShow>
    onHeadChange(callback: () => void): () => void
  }
  theme: {
    getVars(): SuperOneThemeVars
    onChange(callback: (vars: SuperOneThemeVars) => void): () => void
  }
  isDarkMode(): boolean
  onDarkModeChange(callback: (isDark: boolean) => void): () => void
}

declare global {
  interface Window {
    superone: SuperOne
  }
}

` + 'export {}\n'
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
