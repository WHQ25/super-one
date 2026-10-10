# Mobile Codex realtime voice

A paired iOS or Android phone carries foreground voice for a new or existing Codex
conversation hosted by an online desktop. The conversation's official Codex
account, model/effort, permissions, tools and backing thread remain on desktop.
Custom API providers, older desktops without the capability and routed CLI hosts
do not offer this feature.

Starting voice carries the phone's displayed backing model, reasoning effort and
Fast tier through the existing Session settings path before Codex negotiation.
It does not choose a realtime audio model. The selected account must match the
conversation's effective account; a mismatch rejects startup instead of switching
credentials or silently using a different account.

## User flow

The native composer's voice action group sits at the far right of the input and appears
on the new-session landing before any
message is sent, and on existing conversations. On the landing, the host's harness
catalog advertises protocol support and the phone checks the selected official
account. Tapping voice first creates an empty conversation using the displayed
account, model, effort, permissions, worktree and additional directories. Typed
draft text stays saved; creation sends no synthetic user turn or model request.
Cancellation, backgrounding or connection loss fences late creation before capture.
The authoritative creation/restore snapshot refreshes voice capability even if an
earlier query raced the optimistic session ID and failed or returned unsupported.

The phone composer's voice and Send buttons move as one group: inside the input
with the keyboard down, on the upper action row with it up, voice always before
Send. Empty drafts without attachments show only voice. The voice icon starts
the call. While a call is starting, active or stopping, text composers instead
show a 32-point circular waveform inside the same 44-point action target. It uses
the call's real input/output levels and returns to its owning voice history;
the backing Codex view switches directly, and other conversations first reopen
the owning session/project. This return entry is available even when the viewed
conversation cannot start voice. Other chat conversations never stack a second
voice Composer under their text Composer. Microphone access is requested
on that explicit action; denial shows a Settings action. Connecting text
remains until native media connects, a remote audio track is live and desktop
acknowledges readiness. Connecting and stopping have no animated indicator.
Acknowledged readiness plays the desktop's synthesized choir cue once through
InCallManager's existing native call player. The bundled MP3 is rendered offline
from the actual desktop synthesis by `bun run generate:voice-cue`, with shared
chord/timing parameters and the same output gain. Regenerate the bundled cue when
desktop synthesis changes. The microphone is guarded around the cue onset without
overwriting user mute; playback/timers are cancelled on teardown. The Expo plugin
bundles the resource for both native platforms, requiring a dev-client rebuild.

In the voice view, the call uses the text composer's horizontal inset and rounded
border around one 52-point bottom row. The text editor stays mounted with its saved draft;
hangup or switching to the backing Codex view restores it, so typed input can steer
work during a call. A pending native decision temporarily owns the same slot. Away from
chat, the voice Composer stays at the bottom with mute and hangup controls.
UI hangup silences both directions immediately, commits the stopping hint before
native teardown, and awaits remote closure. Background flushes any deferred
cleanup immediately. An empty transcript distinguishes connecting, connected,
stopping, stored voice history and the backing Codex history; media readiness
updates the hint even without a new transcript event. Hints use the document locale.
Microphone mute sits on the left and end/cancel on the right. During an active call,
thin overlapping waves in the shared Claude Ultrathink rainbow palette fill all
space between them, without a visible listening label. The approved motion values
are speed 1.6, amplitude 1.3 and glow 0.4. Native WebRTC `media-source` capture and
`inbound-rtp` decoded playback statistics supply actual audio levels; interval RMS
uses energy/duration deltas, with `audioLevel` as the fallback. A single non-overlapping
stats loop samples the existing peer at up to 10 Hz. It does not acquire another
microphone or use transcript/call status as invented audio activity. Meter updates
go directly to Reanimated values and Skia on the UI thread without rerendering chat.
Silence returns to a flat line, and microphone mute gates capture alone while agent
audio continues to drive the wave. Hangup/failure cancels sampling, zeros levels and
fences late stats. Reduce Motion stops the flowing phase while preserving the level
readout; background ends the call. Playback volume uses
the phone's system controls. Before connection and while stopping, microphone
mute is disabled; permission denial or an error replaces it with Settings or
Retry. The end/cancel
action uses the desktop Power icon, white on a red circular background. Distance sensor
events route phone playback to the receiver while near the ear and to the speaker
when away. Android uses the same receiver/proximity state to blank the screen and
prevent accidental touches, releasing that protection when moved away or the call
closes. This uses the native proximity screen lock, not a device lock action; iOS
retains its native proximity monitoring. Android native device availability preserves wired/Bluetooth headset
priority; iOS wired-headset events also suspend phone routing. Sensor/device listeners
are removed before native audio focus is released.

The top-right session menu switches between separate voice and backing Codex histories,
including after hangup. Switching does not stop or resubscribe the call. User and
assistant item starts/deltas appear as live speech rows in the voice history.
Completion replaces the same row rather than duplicating
it, and only completed speech enters the durable timeline. Unfinished captions are
cleared when the call closes. Caption updates send only changed rows to the WebView.
Delegated work uses the desktop's shared activity mapping and status row: unfinished
work stays below the newest speech, and settled Detail rows follow their originating
voice turn. Tapping a row switches to the corresponding backing message. Canonical
backing rows ride the restore snapshot, so earlier voice turns retain their work
markers even outside the current history page. A voice-only session becomes durable
when Codex attaches its thread, even without a typed message. The database list
notification refreshes all desktop windows as well as paired phones.

Locking the phone or actually entering background ends voice and releases capture
immediately. iOS permission sheets may briefly report `inactive`; that transition
is allowed. Foreground return never restarts a call. Hangup stops voice while an
already delegated Codex task and its approvals continue in the conversation.
The desktop must stay online throughout the call.

## Ownership and media

| Responsibility | Implementation |
|---|---|
| Typed capability, identity and signals | `packages/shared/src/realtime-voice.ts` |
| Host-wide reservation and directed signaling | `apps/desktop/src/main/session/realtime-voice-host.ts` |
| Session-owned call interest | `apps/desktop/src/main/session/realtime-voice-interest.ts` |
| Authenticated native phone RPCs | `apps/desktop/src/main/remote/phone-voice-methods.ts` |
| Renderer ingress and directed window signaling | `apps/desktop/src/main/agent/realtime-voice-control.ts` |
| Codex start/stop and closure barrier | `apps/desktop/src/main/codex/codex-realtime.ts` |
| Phone call lifecycle and transport adapter | `apps/mobile/src/voice/voice-service.ts`, `relay-voice-control.ts` |
| Native microphone, playback, mute and audio focus | `apps/mobile/src/voice/native-voice-media.ts` |
| Native audio metering and waveform | `voice-audio-levels.ts`, `voice-waveform.tsx` |
| Native controls and app wiring | `mobile-voice-controls.tsx`, `use-mobile-voice.ts` |

One reservation includes starting, active and stopping calls across every phone
and desktop window. Attempt IDs, host epoch, call ID and generation prevent old
answers, readiness reports and stops from affecting a new call. Cancellation
before start retires that attempt. Stop waits for voice closure; uncertain cleanup
holds admission. A start failure retains its cleanup handle until upstream teardown
can be confirmed. Session disposal is an authoritative teardown boundary.

The authenticated descriptor must serve all four `session.voice*` methods before
the phone offers voice. Mutations use the endpoint's exact session lease proof.
Call interest survives chat navigation and encrypted channel replacement; the
host renews that admitted grant without reacquiring after takeover. Revocation or
pairing removal ends the call, and disconnect releases it after the recovery grace.

The phone creates the offer with native WebRTC. Authenticated encrypted LAN/relay
control carries it to desktop, which starts official Codex realtime on the
existing thread. The answer goes only to the initiating phone/window. Account
credentials and ephemeral API tokens stay off the phone; audio uses the native
phone-to-service WebRTC connection. Desktop-proxied media and relay audio are
outside this release.

SDP never enters Session reduction, history, replay or generic event fanout.
Generic broadcasters reject signaling events, and trace serialization removes SDP
fields and echoed SDP errors at command, receipt and app-server wire paths. Normal
speech items and delegated turns use the existing durable timeline.

Media/control disconnect has an eight-second recovery grace. Recovery checks the
same host/call identity; a replacement desktop process ends local capture. A
stopped phone process's owned call is reconciled against its original Session
before a new microphone is opened.

## Native compatibility

Expo 54 uses WebRTC 124.0.6, config plugin 13.0.0 and InCallManager 4.3.0. Both native
modules are needed; absent modules disable the action. Microphone usage text and
Android Bluetooth connect permission belong to native config. This requires new
iOS/Android binaries and their fingerprint runtime, followed by matching JS.
An OTA update cannot add the missing native modules.
Camera and image-picker plugins share the microphone usage description: setting
image-picker's microphone permission to `false` removes Android `RECORD_AUDIO`
even when WebRTC adds it. Existing generated native trees containing that removal
require a clean prebuild; changing the JS bundle cannot repair an installed APK.

## Acceptance

Focused tests cover actual remote command ingress and directed replies, logging
redaction, Session replay/fanout exclusion, host races, interest retention, late
permission/capture results, immediate media cleanup, readiness, mutes, reconnect,
foreground policy, desktop renderer fencing and delegated-task continuation.

Native compilation establishes module compatibility; offline preview exercises
controls without media. End-to-end acceptance requires rebuilt iOS/Android clients
and an authenticated official Codex desktop to exercise audible media, native
routes, real lifecycle transitions and shared ownership. Fake media ports and
App Server requests establish protocol behavior without proving those device effects.

Offline preview: `superone-dev://native-preview?page=Voice&theme=dark&locale=zh`.
It uses the production controls without acquiring capture or making service calls.
Related contracts: [mobile control](../architecture/mobile-remote-control.md),
[Codex](../harness/codex/contracts.md), and
[native builds](../../apps/mobile/docs/agent-reference/native-builds.md).
