"use client"

import {
  CollaborationMock,
  NewSessionMock,
  RealtimeVoiceMock,
} from "@superone/desktop-mocks/desktop"
import { BrandedSurface } from "@/components/branded-surface"

export function ProductShowcase() {
  return (
    <div className="flex w-full flex-col gap-6">
      <BrandedSurface className="w-full overflow-x-auto rounded-2xl p-2 shadow-sm ring-1 ring-border">
        <div className="min-w-[52rem]">
          <NewSessionMock
            defaultHarness="codex"
            height={620}
            showActivityPanelToggle
            showTerminalToggle
          />
        </div>
      </BrandedSurface>

      <div className="grid gap-6 lg:grid-cols-2">
        <BrandedSurface className="overflow-hidden rounded-2xl p-2 shadow-sm ring-1 ring-border">
          <RealtimeVoiceMock
            defaultView="realtime"
            defaultVoiceState="active"
            speakingSegmentIds={["call-2-assistant-1"]}
          />
        </BrandedSurface>

        <BrandedSurface className="overflow-hidden rounded-2xl p-2 shadow-sm ring-1 ring-border">
          <div className="p-3">
            <CollaborationMock />
          </div>
        </BrandedSurface>
      </div>
    </div>
  )
}
