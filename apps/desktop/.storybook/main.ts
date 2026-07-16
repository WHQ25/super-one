import type { StorybookConfig } from '@storybook/react-vite'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/**
 * Absolute package roots for monorepo / hoisted installs.
 * Without this, Storybook can fail to load the React renderer and throw
 * MissingRenderToCanvasError ("Perhaps it needs to be upgraded for Storybook 7.0?").
 */
function getAbsolutePath(value: string): string {
  return dirname(require.resolve(join(value, 'package.json')))
}

const config: StorybookConfig = {
  stories: [
    '../src/renderer/src/**/*.stories.@(ts|tsx|mdx)',
    '../../../packages/ui/src/**/*.stories.@(ts|tsx|mdx)',
    '../../../packages/desktop-mocks/src/**/*.stories.@(ts|tsx|mdx)',
    '../../../packages/video-compositions/src/**/*.stories.@(ts|tsx|mdx)',
    '../../web/components/**/*.stories.@(ts|tsx|mdx)',
  ],
  framework: {
    name: getAbsolutePath('@storybook/react-vite'),
    options: {},
  },
  typescript: {
    check: false,
    // Storybook is launched via .storybook/run.mjs which resolves `typescript`
    // to @typescript/typescript6 (classic API). react-docgen is enough for props.
    reactDocgen: 'react-docgen',
  },
  viteFinal: async (cfg) => {
    cfg.resolve = cfg.resolve ?? {}
    cfg.resolve.alias = {
      ...(cfg.resolve.alias ?? {}),
      '@': resolve(here, '../src/renderer/src'),
    }
    cfg.esbuild = { ...(cfg.esbuild || {}), jsx: 'automatic', jsxImportSource: 'react' }
    cfg.plugins = [...(cfg.plugins ?? []), tailwindcss()]
    return cfg
  },
}

export default config
