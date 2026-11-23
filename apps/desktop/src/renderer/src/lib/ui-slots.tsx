import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createSlotRegistry, type SlotRegistry } from '@superone/ui-slots'

export interface ChatToolBlockSlotProps {
  toolName: string
  toolUseId?: string
  input: string
  params: Record<string, unknown>
  toolSummary?: string
  filePath?: string
  status?: 'streaming' | 'complete'
  isStreaming: boolean
  elapsedSeconds?: number
  result?: string
  cleanResult?: string
  isError?: boolean
  isDenied: boolean
  isTimedOut?: boolean
  allowExpand: boolean
  grouped: boolean
}

export interface SessionHeaderActionSlotProps {
  sessionId: string
  projectPath: string | null
}

export interface ActivityPluginPanelSlotProps {
  panelKey: string
  pluginId?: string
  title?: string
  params: Record<string, unknown>
}

export interface SessionProvidersSlotProps {
  children: ReactNode
}

declare module '@superone/ui-slots' {
  interface SlotMap {
    'session.providers': {
      kind: 'hoc'
      props: SessionProvidersSlotProps
    }
    'session.header.actions': {
      kind: 'list'
      props: SessionHeaderActionSlotProps
    }
    'activity.panel': {
      kind: 'keyed'
      props: ActivityPluginPanelSlotProps
      key: string
    }
    'chat.toolBlock': {
      kind: 'chain'
      props: ChatToolBlockSlotProps
    }
  }
}

let appSlotRegistry: SlotRegistry | null = null

export function getAppSlotRegistry(): SlotRegistry {
  if (!appSlotRegistry) {
    appSlotRegistry = createSlotRegistry()
  }
  return appSlotRegistry
}

export function resetAppSlotRegistryForTest(): void {
  appSlotRegistry = null
}

interface ErrorBoundaryProps {
  resetKey?: string
  fallback: ReactNode | (() => ReactNode)
  onError?: (error: Error, info: ErrorInfo) => void
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  capturedResetKey?: string
}

export class PluginSlotErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, capturedResetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.capturedResetKey) {
      return { hasError: false, capturedResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return typeof this.props.fallback === 'function' ? this.props.fallback() : this.props.fallback
    }
    return this.props.children
  }
}
