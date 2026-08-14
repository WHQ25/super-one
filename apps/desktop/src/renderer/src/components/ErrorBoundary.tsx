import { Component, type ErrorInfo, type ReactNode } from 'react'
import log from 'electron-log/renderer'

/**
 * Last line of defence for the renderer.
 *
 * Without a boundary React unmounts the whole tree on any render-phase throw,
 * leaving an empty `#root` — visually identical to "still loading" and to a
 * hung boot, with nothing in the logs. That ambiguity is what makes renderer
 * crashes expensive to diagnose from a user report (see the Cursor seed-effect
 * storm that surfaced only as "white screen on Windows").
 *
 * So this does two jobs: show the error instead of a blank window, and push it
 * into the main-process log so a packaged build leaves evidence behind.
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    // Reaches ~/Library/Logs/SuperOne/main.log (or %APPDATA%\SuperOne\logs) in
    // packaged builds — the only channel that survives a user-side crash.
    log.error('[renderer] uncaught render error', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleCopy = (): void => {
    const { error, componentStack } = this.state
    void navigator.clipboard?.writeText(
      [error?.message, error?.stack, componentStack].filter(Boolean).join('\n\n'),
    )
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-8 text-foreground">
        <div className="flex max-w-2xl flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-medium">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              The interface hit an unrecoverable error. Reloading usually fixes it — if it keeps
              happening, send the details below along with the app log.
            </p>
          </div>

          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-card p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
            {componentStack ? `\n\n${componentStack}` : ''}
          </pre>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.handleCopy}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    )
  }
}
