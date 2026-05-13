import type { StorybookConfig } from '@storybook/react-vite'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from '@tailwindcss/vite'

const here = dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  stories: [
    '../src/renderer/src/**/*.stories.@(ts|tsx|mdx)',
    '../../../packages/ui/src/**/*.stories.@(ts|tsx|mdx)',
    '../../../packages/desktop-mocks/src/**/*.stories.@(ts|tsx|mdx)',
    '../../../packages/video-compositions/src/**/*.stories.@(ts|tsx|mdx)',
    '../../web/components/**/*.stories.@(ts|tsx|mdx)',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    check: false,
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      tsconfigPath: resolve(here, '../tsconfig.web.json'),
    },
  },
  viteFinal: async (cfg) => {
    cfg.resolve = cfg.resolve ?? {}
    cfg.resolve.alias = {
      ...(cfg.resolve.alias ?? {}),
      '@': resolve(here, '../src/renderer/src'),
    }
    cfg.plugins = [...(cfg.plugins ?? []), tailwindcss()]
    return cfg
  },
}

export default config
