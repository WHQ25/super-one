import type { MiniAppManifest, MiniAppToolDefinition } from '../../shared/miniapp-types'

export interface GeneratedFile {
  path: string
  content: string
}

export interface TemplateOptions {
  name: string
  manifest: MiniAppManifest
  tools: MiniAppToolDefinition[]
}

export function generateVanillaFiles(opts: TemplateOptions): GeneratedFile[] {
  return [
    { path: 'manifest.json', content: JSON.stringify(opts.manifest, null, 2) },
    { path: 'index.html', content: generateVanillaHtml(opts.name, opts.tools) },
  ]
}

export function generateReactFiles(opts: TemplateOptions): GeneratedFile[] {
  const files: GeneratedFile[] = [
    { path: 'public/manifest.json', content: JSON.stringify(opts.manifest, null, 2) },
    { path: 'package.json', content: generatePackageJson(opts.name) },
    { path: 'vite.config.ts', content: generateViteConfig() },
    { path: 'tsconfig.json', content: generateTsconfig() },
    { path: 'index.html', content: generateReactEntryHtml(opts.name) },
    { path: 'src/main.tsx', content: generateReactMain() },
    { path: 'src/App.tsx', content: generateReactApp(opts.name, opts.tools) },
    { path: 'src/superone.d.ts', content: generateSuperoneDts() },
    { path: 'src/index.css', content: '@import "tailwindcss";\n' },
    { path: '.gitignore', content: 'node_modules\ndist\n' },
  ]
  return files
}

function generateVanillaToolHandler(tool: MiniAppToolDefinition): string {
  const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
  const paramNames = Object.keys(props)
  const displayExpr = paramNames.length > 0
    ? 'JSON.stringify(args, null, 2)'
    : `'Tool ${tool.name} called'`
  return `  superone.tools.handle('${tool.name}', function(args) {
    var container = document.getElementById('output');
    var div = document.createElement('div');
    div.className = 'msg';
    div.textContent = ${displayExpr};
    container.appendChild(div);
    return { success: true };
  });`
}

function generateVanillaHtml(name: string, tools: MiniAppToolDefinition[]): string {
  const handlers = tools.map(generateVanillaToolHandler).join('\n\n')
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
  <script>
${handlers}
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

function generateReactToolHandler(tool: MiniAppToolDefinition): string {
  const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
  const paramNames = Object.keys(props)
  const displayExpr = paramNames.length > 0
    ? 'JSON.stringify(args, null, 2)'
    : `'Tool ${tool.name} called'`
  return `    window.superone.tools.handle('${tool.name}', (args) => {
      setMessages((prev) => [...prev, ${displayExpr}])
      return { success: true }
    })`
}

function generateReactApp(name: string, tools: MiniAppToolDefinition[]): string {
  const handlers = tools.map(generateReactToolHandler).join('\n')
  const head = "import { useState, useEffect } from 'react'"
  return `${head}

function App() {
  const [messages, setMessages] = useState<string[]>([])

  useEffect(() => {
${handlers}
  }, [])

  return (
    <div className="p-6 font-sans">
      <h1 className="text-xl font-bold mb-4">${name}</h1>
      <div className="flex flex-col gap-2">
        {messages.map((msg, i) => (
          <div
            key={i}
            className="rounded-lg border p-3 text-sm whitespace-pre-wrap"
            style={{
              background: 'var(--card, #fff)',
              borderColor: 'var(--border, #e7e5e4)',
            }}
          >
            {msg}
          </div>
        ))}
      </div>
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
