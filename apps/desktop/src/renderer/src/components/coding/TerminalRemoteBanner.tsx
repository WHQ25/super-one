import { Smartphone } from 'lucide-react'

export function TerminalRemoteBanner(props: { onDisconnect: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-t border-border px-4 py-2 text-sm text-muted-foreground">
      <Smartphone className="size-3.5 shrink-0" />
      <span>Remote terminal active — observation mode.</span>
      <button
        type="button"
        onClick={props.onDisconnect}
        className="text-foreground underline underline-offset-2 hover:opacity-80"
      >
        Disconnect
      </button>
    </div>
  )
}
