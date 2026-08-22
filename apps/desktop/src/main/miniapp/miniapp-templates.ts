import type { MiniAppManifest } from '@superone/shared/miniapp-types'
import authorDts from '@superone/shared/miniapp-author-api.d.ts?raw'
import hostDts from '@superone/shared/miniapp-host-api.d.ts?raw'

export interface GeneratedFile {
  path: string
  content: string
}

export interface TemplateOptions {
  name: string
  manifest: MiniAppManifest
}

export function generateVanillaFiles(opts: TemplateOptions): GeneratedFile[] {
  return [
    { path: 'manifest.json', content: JSON.stringify(opts.manifest, null, 2) },
    { path: 'index.html', content: generateVanillaHtml(opts.name) },
    { path: 'node.js', content: generateVanillaHostEntry() },
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
    { path: 'src/node.ts', content: generateReactHostEntry() },
    { path: 'src/superone.d.ts', content: generateSuperoneDts() },
    { path: 'src/superone-host.d.ts', content: generateHostDts() },
    { path: 'src/index.css', content: '@import "tailwindcss";\n' },
    { path: '.gitignore', content: 'node_modules\ndist\n' },
    { path: 'dist/manifest.json', content: JSON.stringify(opts.manifest, null, 2) },
    { path: 'dist/index.html', content: placeholderHtml },
    { path: 'dist/node.js', content: generateVanillaHostEntry() },
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

function generateVanillaHostEntry(): string {
  return `export async function activate(context) {
  context.webview.onMessage((message) => {
    console.log('[miniapp-host] message from WebView', message)
  })
}

export async function deactivate() {}
`
}

function generatePackageJson(name: string): string {
  const pkg = {
    name: slugify(name),
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build && bun build src/node.ts --target=node --format=esm --outfile=dist/node.js',
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

function generateReactHostEntry(): string {
  return `import type { SuperOneMiniAppContext } from './superone-host'

export async function activate(context: SuperOneMiniAppContext) {
  context.webview.onMessage((message) => {
    console.log('[miniapp-host] message from WebView', message)
  })
}

export async function deactivate() {}
`
}

export function generateSuperoneDts(): string {
  const body = authorDts.replace(/^export /gm, '')
  return `${body}
declare global {
  interface Window {
    superone: SuperOne
  }
}

export {}
`
}

export function generateHostDts(): string {
  return hostDts
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
