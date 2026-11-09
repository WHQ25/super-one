# Doubao realtime voice frontend

Status: in-progress · Updated: 2026-11-09
Goal: Doubao Seeduplex is the desktop voice shell, and the current session agent does the work.
Proposal: [doubao-realtime-voice.md](../proposals/doubao-realtime-voice.md)
Long-term docs affected: none until the call path ships. Codex voice docs stay WebRTC-specific.

## Delivery

1. Shared JSON event codec and a live spike that proves host speech replaces Doubao chat.
2. Desktop call on the current session, reusing the Codex voice chrome and one-call admission.
3. Barge-in, mute, exit intent, steer-or-queue, and session id resume.

## Evidence and boundaries

- No phone, CLI node, SC voice, or new harness id in this work.
- No Volcengine call runs in unit tests. The spike reads `DOUBAO_API_KEY` from the environment and must not print it.
- The live spike has accepted host speech and barge-in. Handshake-only still does not exercise the call. The desktop call is the next change.

## Progress

- The Seeduplex codec, `session.create` payload, server-notice mapping, and spoken-tag extraction are in `packages/shared/src/doubao-realtime.ts`. The older binary frame codec is gone.
- From `apps/desktop`, `bunx vitest run ../../packages/shared/src/doubao-realtime.test.ts` passed 13 tests. `response.canceled` maps to `response-canceled`.
- Live spike script is `apps/desktop/scripts/doubao-realtime-spike.ts`. Cancel plus `speech_text_buffer.commit` passed: `defaultAudioBytes` was 0, the acknowledgement was 86442 bytes of `chat_tts_text`, and a later commit was 67680 bytes of `chat_tts_text`. Doubao still emitted the chat fragment `你是在`; it was not spoken.
- A new call injects the saved voice transcript after `session.created` (`conversation.item.create`, newest 20 user/assistant pairs). A delegation envelope's `<transcript_delta>` is only the lines since the previous handoff.
- Barge-in passed. Overlap speech started with the acknowledgement. `transcription.started` arrived just after that audio ended, at overlap frame 41 of 118. `commitDropped` was true, `summarySent` stayed false, `defaultAudioBytes` was 0, acknowledgement audio was 75786 bytes of `chat_tts_text`, and `audioAfterCancel` was 0. The server confirmed the first cancel with `response.canceled`. No Doubao chat text arrived. The desktop call can start. Product barge-in, mute, exit, steer, and session resume are still unbuilt.

## Spike

Handshake only:

```bash
bun apps/desktop/scripts/doubao-realtime-spike.ts
```

Speech checks, with 16 kHz mono s16le PCM (not a wav). `DOUBAO_API_KEY` comes from the environment:

```bash
DOUBAO_PCM_PATH=/tmp/utterance.pcm bun apps/desktop/scripts/doubao-realtime-spike.ts
```

Exit 0 means the requested checks passed. A handshake-only run says `speechChecks: skipped` and does not unlock the UI. Exit 1 is a protocol or suppression failure. Exit 2 means the API key was absent. Speech uses `response.cancel` then `speech_text_buffer.commit`. `speech_text_buffer.replacement` is not used.
