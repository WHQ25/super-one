import type { Preview } from '@storybook/react-vite'
import React, { useEffect } from 'react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import '../src/renderer/src/styles/index.css'
import { installIpcMocks } from './mock-ipc'
import { resources } from '@superone/shared/i18n'
import type { Locale } from '@superone/shared/agent-types'
import { MockLocaleProvider } from '@superone/desktop-mocks'

const sbOverrideStyle = document.createElement('style')
sbOverrideStyle.textContent = 'html, body { overflow: auto !important; scrollbar-gutter: stable !important; }'
document.head.appendChild(sbOverrideStyle)
import { useAppStore } from '../src/renderer/src/stores/app'
import {
  createDefaultPerSessionState,
  createDefaultProjectState,
  useChatStore,
} from '../src/renderer/src/stores/chat'
import { useHarnessTheme } from '../src/renderer/src/hooks/useHarnessTheme'
import { clampBrandHue, brandHueToOklch } from '@superone/shared/harness-brand'
import type { HarnessId } from '@superone/shared/session-types'
import { cn } from '@superone/ui/lib/utils'

installIpcMocks()

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  })
}

const SB_PROJECT = '__storybook__'
const SB_SESSION = 'sb'

function applyHarness(harness: HarnessId): void {
  const session = createDefaultPerSessionState()
  session.preferredProvider = harness
  const project = createDefaultProjectState()
  project._activeSessionId = SB_SESSION
  project._sessions = { [SB_SESSION]: session }
  useChatStore.setState({
    activeProject: SB_PROJECT,
    projectSessions: { [SB_PROJECT]: project },
  })
}

function setBrandHue(harness: HarnessId, hue: number | null): void {
  useAppStore.setState((s) => ({
    brandHues: { ...s.brandHues, [harness]: hue },
  }))
}

const BrandHueDial: React.FC<{ harness: HarnessId }> = ({ harness }) => {
  const hue = useAppStore((s) => s.brandHues[harness])
  const display = hue ?? 240
  const swatch = brandHueToOklch(display)
  return (
    <div
      className="border-border bg-popover/95 text-popover-foreground fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-sm backdrop-blur"
      data-storybook-overlay
    >
      <span
        aria-hidden
        className="size-3 rounded-full border border-black/10"
        style={{ background: swatch }}
      />
      <span className="opacity-60">{harness} hue</span>
      <input
        type="range"
        min={0}
        max={360}
        step={1}
        value={display}
        onChange={(e) => setBrandHue(harness, clampBrandHue(Number(e.target.value)))}
        className="w-36 accent-[var(--primary)]"
        aria-label={`${harness} brand hue`}
      />
      <span className="w-10 text-right tabular-nums">
        {hue === null ? 'def' : `${hue}°`}
      </span>
      <button
        type="button"
        onClick={() => setBrandHue(harness, null)}
        className="hover:bg-accent hover:text-accent-foreground rounded px-1.5 py-0.5"
      >
        reset
      </button>
    </div>
  )
}

const HarnessThemeBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useHarnessTheme()
  return <>{children}</>
}

const ThemeDecorator = (
  Story: React.ComponentType,
  ctx: {
    globals: { theme?: 'light' | 'dark'; harness?: HarnessId; locale?: Locale }
    parameters: { layout?: 'centered' | 'fullscreen' | 'padded' }
  },
) => {
  const theme = ctx.globals.theme ?? 'light'
  const harness: HarnessId = ctx.globals.harness ?? 'claude'
  const locale: Locale = ctx.globals.locale ?? 'en'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    applyHarness(harness)
  }, [harness])

  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale)
  }, [locale])

  return (
    <HarnessThemeBridge>
      <MockLocaleProvider locale={locale}>
        <div className={cn('min-h-screen bg-background text-foreground', ctx.parameters.layout !== 'fullscreen' && 'p-6')}>
          <Story />
          {theme === 'light' && <BrandHueDial harness={harness} />}
        </div>
      </MockLocaleProvider>
    </HarnessThemeBridge>
  )
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    layout: 'centered',
    backgrounds: { disable: true },
  },
  globalTypes: {
    theme: {
      description: 'Color scheme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    harness: {
      description: 'Harness',
      defaultValue: 'claude',
      toolbar: {
        title: 'Harness',
        icon: 'box',
        items: [
          { value: 'claude', title: 'Claude' },
          { value: 'codex', title: 'Codex' },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'Language',
      defaultValue: 'en',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'zh', title: '中文' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [ThemeDecorator],
}

export default preview
