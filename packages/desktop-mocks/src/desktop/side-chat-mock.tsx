"use client"

import { useEffect, useState } from "react"
import { GitFork, MessageCirclePlus, MessagesSquare } from "lucide-react"
import { Badge } from "@superone/ui/components/ui/badge"
import { Button } from "@superone/ui/components/ui/button"
import { Checkbox } from "@superone/ui/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@superone/ui/components/ui/dialog"
import { cn } from "@superone/ui/lib/utils"
import { ChatInputMock } from "./chat-input-mock"
import type { Harness } from "./icons"

export interface SideChatMockProps {
  parentTitle?: string
  temporaryNotice?: string
  composerPlaceholder?: string
  harness?: Harness
  contextPct?: number
  closeConfirmationOpen?: boolean
  onCloseConfirmationChange?: (open: boolean) => void
  onConfirmClose?: () => void
  className?: string
}

/**
 * The initial side-chat surface from the activity panel.
 *
 * The empty transcript is deliberate: the fork carries the parent conversation
 * as model context, but does not replay those messages into this narrow pane.
 */
export function SideChatMock({
  parentTitle = "Refactor the activity panel",
  temporaryNotice =
    "Side chats are temporary. This conversation cannot be recovered once you close the tab or quit the app.",
  composerPlaceholder = "Ask a follow-up without leaving the main conversation",
  harness = "claude",
  contextPct = 0.46,
  closeConfirmationOpen = false,
  onCloseConfirmationChange,
  onConfirmClose,
  className,
}: SideChatMockProps) {
  const [confirmOpen, setConfirmOpen] = useState(closeConfirmationOpen)
  const [dontAskAgain, setDontAskAgain] = useState(false)

  useEffect(() => {
    setConfirmOpen(closeConfirmationOpen)
  }, [closeConfirmationOpen])

  useEffect(() => {
    if (confirmOpen) setDontAskAgain(false)
  }, [confirmOpen])

  const setOpen = (open: boolean) => {
    setConfirmOpen(open)
    onCloseConfirmationChange?.(open)
  }

  const confirmClose = () => {
    setOpen(false)
    onConfirmClose?.()
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <MessageCirclePlus className="size-6" aria-hidden />
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <h2 className="text-sm font-medium">Side Chat</h2>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{temporaryNotice}</p>
        </div>

        <div className="flex max-w-sm flex-wrap items-center justify-center gap-1.5">
          <Badge variant="secondary">
            <GitFork aria-hidden />
            Inherited context: {parentTitle}
          </Badge>
          <Badge variant="outline">
            <MessagesSquare aria-hidden />
            Parent transcript not replayed
          </Badge>
        </div>

        <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
          The agent can use the parent conversation as context, while this transcript starts empty for your follow-up.
        </p>
      </div>

      <ChatInputMock
        className="shrink-0"
        harness={harness}
        placeholder={composerPlaceholder}
        contextPct={contextPct}
        workDirName="super-one"
        branch="main"
        branchDirty={false}
      />

      <Dialog open={confirmOpen} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Close this side chat?</DialogTitle>
            <DialogDescription>
              Side chat cannot be recovered once you close this tab.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row items-center gap-2">
            <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={dontAskAgain}
                onCheckedChange={(checked) => setDontAskAgain(checked === true)}
              />
              Don&apos;t ask again
            </label>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmClose}>
              Confirm Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
