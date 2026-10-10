# Mobile Codex realtime voice

Status: implementation complete; device acceptance in-progress · Updated: 2026-10-10
Goal: paired phones carry foreground voice on a new or existing desktop Codex thread.
Proposal: [mobile-codex-realtime-voice.md](../proposals/mobile-codex-realtime-voice.md)
Long-term docs affected: [mobile control](../architecture/mobile-remote-control.md),
[Codex contracts](../harness/codex/contracts.md), mobile transport/native guidance.

## Delivery

1. Native compatibility and replaceable media/control ports.
2. Shared host control, directed signaling, ownership and scoped subscriptions.
3. Independent native media service and foreground/disconnect lifecycle.
4. Capability-driven controls, colocated stories and native previews.
5. Focused tests/typechecks/native checks; physical/API acceptance separately.

## Evidence and boundaries

- Initial worktree: detached HEAD, only the existing proposal intent-to-add.
- Maintainer compatibility table lists Expo 54 with `react-native-webrtc`
  124.0.6 and `@config-plugins/react-native-webrtc` 13.0.0. These exact versions
  are pinned here. Native compile and physical Android evidence are recorded below;
  physical iOS and the remaining route/lifecycle matrix still need acceptance.
- No release, commit, push or authenticated voice call is authorized implicitly.

## Progress

- Repository contracts and existing desktop/mobile paths inspected.
- Native WebRTC/audio routing adapter, shared host admission and directed signaling implemented.
- Session call interest survives navigation; local capture stops immediately on background/cancel.
- Capability-driven native controls, English/Chinese text, colocated story and offline Voice gallery implemented.
- Voice startup applies the phone's displayed backing model/effort/Fast selection;
  account mismatches reject before admission, and custom host defaults remain unsupported.
- Permanent feature/architecture/harness/native guidance updated.
- New-session voice creates an empty backing conversation while retaining landing
  selections and typed drafts. Creation snapshots refresh capability after an
  early query races the optimistic session ID.
- Camera/image-picker microphone configuration no longer removes voice permission;
  fresh native trees/binaries are still required to deliver this correction.

## Validation

- Rebuilt Android dev client installed and reloaded on a physical phone. The
  maintainer confirmed audible calls and desktop visibility of phone-created
  voice Sessions. Follow-up UI includes separate voice/backing histories, live
  captions, compact audio-reactive controls, keyboard-aware action placement,
  proximity routing/screen protection and the native ready cue.
- Latest focused ready-cue/service/config tests, native presentation/Composer
  tests and waveform paint regressions passed. Android arm64 Debug build passed;
  the packaged cue matches the generated asset. Both clients' cue gain increased
  by about 22 dB, with the decoded MP3 peaking at -12.3 dBFS and no PCM clipping.
- Audio-quality investigation is deferred at the maintainer's request after the
  same cue also sounded poor through the phone's ordinary media player. Desktop
  voice and cue playback were confirmed normal; no audio-routing diagnosis is
  claimed from that comparison.

- Physical feedback follow-up: default speaker routing, input-right voice entry,
  bottom voice Composer, incremental user/assistant captions and desktop session-list
  invalidation are implemented. Native adapter/component/bridge, shared timeline,
  reducer, runtime and host persistence/list regression tests pass; mobile and
  desktop main/renderer typechecks and generated chat-document build pass.
- Read-only Dev DB/API verification confirms the phone-created voice-only Session
  is durable and listed without synthetic messages. Dev desktop and cleared Metro
  are running for manual phone acceptance; no native rebuild is needed for this step.

- New-session/first-send entry correction: 48 mobile runtime/service/native-config
  tests, 67 mobile hook/composer/control/catalog tests, and 14 host catalog tests
  passed. Mobile and desktop main-process typechecks passed. The complete Expo
  plugin chain preserves microphone permission on fresh native roots; the existing
  installed Android binary was not rebuilt for this correction.
- Desktop node/web and mobile typechecks passed.
- Desktop remote ingress, trace redaction, Session replay exclusion, host reservation/interest,
  broadcaster rejection and renderer stale-peer tests passed. Existing AgentService/Session
  scoped suites passed with their pre-existing conditional skips.
- Codex protocol/start clock/selection/lifecycle tests passed, including cleanup-handle retry
  and delegated-task continuation after voice closure.
- Mobile service/lifecycle/transport/preview routing: 17 tests passed. Native media/controls: 6 tests passed.
  Jest exits normally; no forced exit is needed.
- Mobile harness selection: 30 tests passed, including default-account resolution for voice.
- Expo prebuild completed for both platforms; iOS Pods installation completed.
- Initial Android `app:assembleDebug` (arm64-v8a) succeeded before physical delivery.
- iOS Simulator Debug build succeeded with `CODE_SIGNING_ALLOWED=NO` and
  `IPHONEOS_DEPLOYMENT_TARGET=15.1`. Xcode 27 rejects several existing Pods' lower
  deployment targets on the initial default command; this is a validation command override,
  not a source/config change.
- Fingerprint includes WebRTC, InCallManager and their config plugin; ignored native trees
  appear only as unhashed `bareNativeDir` markers; their contents are excluded. Static EAS/runtime policy check passed.

## Remaining acceptance

Physical Android Wi-Fi/LAN calls now have audible-media acceptance. Rebuilt iOS
clients, cellular/relay calls, Bluetooth/headset route changes, the full
background/lock/permission matrix, task approvals, second-endpoint contention and
runtime restart recovery still need acceptance. Native compilation and fake media
ports do not prove these remaining device effects.
Acceptance checklist:

- Wi-Fi/LAN and cellular/relay: bidirectional audible speech, first ready state,
  transcript persistence and return to the same backing conversation.
- Wired/Bluetooth headphones, receiver and speaker: input/output mute, route
  changes, cancellation and release of microphone/audio focus on hangup.
- Permission denial, iOS permission-sheet `inactive`, actual background/lock,
  foreground return, late capture and stop during pending startup.
- Navigation between chats and projects, return-to-source and delegated approvals;
  one call across a second phone and another desktop window.
- Control/media disconnect, reconnection within and beyond grace, desktop restart,
  app restart, account/provider mismatch and uncertain teardown.

Keep this plan and the accepted proposal until that acceptance is recorded;
then remove them in the completing change per `docs/README.md`.
