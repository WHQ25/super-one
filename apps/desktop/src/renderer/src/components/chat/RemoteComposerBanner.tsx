import { Smartphone } from 'lucide-react'

export function RemoteComposerBanner({ onDisconnect, busy = false }: { onDisconnect: () => void; busy?: boolean }) {
  return <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
    <span className="flex min-w-0 items-center gap-x-2">
      <Smartphone className="size-3.5 shrink-0" />
      <span>Remote draft active — observation mode.</span>
    </span>
    <button type="button" disabled={busy} onClick={onDisconnect}
      className="text-foreground underline underline-offset-2 hover:opacity-80 disabled:opacity-50">
      Disconnect
    </button>
  </div>
}
