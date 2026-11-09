# Doubao realtime voice frontend

Status: accepted · Updated: 2026-11-09
Plan: [doubao-realtime-voice.md](../plans/doubao-realtime-voice.md)

Scope: desktop voice on the current session. Doubao Seeduplex (model `1.2.6.1`) hears and speaks. The session's existing agent does the work. The call chrome stays the Codex voice surface.

## Problem

Codex realtime voice is a WebRTC session on an official Codex thread. `Session.startRealtimeVoice` rejects every other harness, and custom Codex providers have no voice path. Doubao's Seeduplex dialog is a separate JSON WebSocket. It can sit in front of any session that can accept a user turn.

The older binary dialog (`wss://openspeech.bytedance.com/api/v3/realtime/dialogue`, app id plus access key) is the server-style credential set. Seeduplex uses one `X-Api-Key` from the Doubao speech console. An Ark chat key does not open this socket.

## Decisions

- Seeduplex only. The socket is `wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue`. Each WebSocket text frame is one JSON event. Audio is base64 inside that JSON. SC voices, cloned speakers, singing, and Doubao web search stay out. The only tool is `delegate_task`.
- Desktop only. Phone voice remains Codex WebRTC. Doubao has no SDP offer, so the phone path is a later media port.
- One composer voice button. `auto` keeps official Codex sessions on `thread/realtime/start`. Other sessions that can send a turn use Doubao when the speech API key exists. A setting can force `codex` or `doubao`. Both providers share the existing one-call admission.
- Doubao talks with the user. A finished utterance stays with Doubao. Project work is delegated only when Doubao calls `delegate_task`. That call stays silent: the host does not ask for a handoff sentence and does not speak a fixed phrase. User transcription that repeats the line so far is folded to the new tail. A revision replaces the line, including one that only rewrites the ending, instead of appending it. The completed transcript replaces it. A later utterance opens its own line.
- Uplink is 16 kHz mono PCM s16le, 20 ms frames, in `input_audio_buffer.append`. Downlink requests `pcm_s16le` at 24 kHz and plays through the existing voice worklet. The WebRTC playback class stays on the Codex path.
- Open-mic full duplex. The host streams 20 ms frames with `input_audio_buffer.append` while the user is speaking, at the realtime rate, and keeps at most 500 ms queued so a stalled pacer cannot hold the rest of the utterance. Seeduplex decides the turn. The host does not send `input_audio_buffer.commit` to force one. Closing the mic sends `input_audio_mute.commit`; opening it sends `input_audio_unmute.commit`.
- Doubao's own audio plays. After `delegate_task` the host tells Doubao to stay silent and drops a handoff sentence that is already playing. The task is a `<realtime_delegation>` envelope, not an ordinary user turn: `<input>` is the task, a preamble outside that tag says the turn came from a voice session, and `<transcript_delta>` carries the spoken lines since the previous handoff. Lines already sent stay out of the next envelope. The chat bubble is that envelope. While the backing turn runs, the voice transcript shows the same working row Codex uses. Each finished text block of the agent's reply appears in the voice transcript as soon as that block closes, including tables, code, and images. Speech uses `response.cancel` then `speech_text_buffer.commit` and reads only the prose in that block. The delegation preamble does not ask the agent to avoid tables or code. The host does not wait for the rest of the turn. A turn that showed no block ends with `做完了`. Idle from a turn that started before the delegated send does not say that or close the watch. Another `delegate_task` while the watch is open keeps the same message window and the prose already queued. While the agent turn is already running, that delegation is steered with the composer steer action (`priority: 'now'`), not left parked until the turn idles. A delegation while the session is idle still starts a normal turn. Grok interjects into the same turn. Antigravity `now` cancels the live turn and starts the next one. The host does not call `session.interrupt`. `speech_text_buffer.replacement` does not replace Doubao's own audio, and a later replacement closes the session. An open-mic transcription start while a report has not started does not drop it. If the user speaks again during the agent turn, Doubao answers that utterance and a queued block waits until that reply ends. Each finished block is shown in the voice transcript when it closes, even while speech waits. Talking over a sentence that is playing, or over a block already queued, stops that audio and drops the rest of that readout. Talking after a sentence has finished, while nothing else is queued, does not drop blocks the agent has not written yet. The host does not cancel Doubao's reply to the user. Stopping the call sends `session.close` and leaves the agent turn running.
- Barge-in sends `response.cancel` while audio is already playing and drops a host report that has started. The host also stops playback when microphone RMS stays at or above 0.08 for 600 ms, without waiting for server transcription. Playback can still be queued after the server finishes an utterance; a later user turn and each new utterance drop that tail. Host PCM still in the speakers counts as speaking, so a 600 ms barge drops the rest of the readout. A transcription start while that audio is still audible drops the leftover playback and does not drop blocks the agent has not written yet. After that audio has played out, speech in the gap does not drop those blocks. A mic start with no words holds the next block for a short moment so it does not cancel the turn the user just opened, and does not hold it until the agent turn idles. An empty end of speech still releases the block at once. A new audio start after a cancel plays, and only frames that arrive before that start stay dropped. A later sentence of the same host readout appends behind audio that is still queued, so the next finished agent block does not cut the sentence already playing. Cancelling the server is limited to audio it is still sending. A transcription start before a report has started does not drop the report. The live spike observed `conversation.item.input_audio_transcription.started` for speech that started during acknowledgement playback. The server confirms cancel with `response.canceled`.
- Resume sends the `session.id` from `session.created` on the next `session.create` inside the same call. The host does not invent that id. A new call on a session that already has a voice transcript injects that transcript once, after `session.created`, with `conversation.item.create`: user/assistant pairs, at most the newest 20 rounds, no timestamps. A trailing user line with no answer is left out. A socket retry that already passed `session.id` does not inject those pairs again. Voice transcript item ids are unique per call, so a later call on the same session appends instead of replacing earlier lines.
- `status_code` `20000002` on `response.output_audio.done` hangs up when the server sends it. An idle end (`45000003`) ends the call. A 5xx finishes the session and retries once. The host does not reconnect in the middle of an utterance.
- Credentials stay in the desktop main process, encrypted with the existing secret store. The renderer receives transcripts, call activity, and playback PCM. Logs keep `X-Tt-Logid` and omit the key and raw audio.

`supportsRealtimeVoice` continues to mean Codex WebRTC. Doubao is a separate capability so phones and remote nodes do not advertise an SDP call they cannot place.

## Contract

The shared event codec lives in `packages/shared/src/doubao-realtime.ts`. The desktop WebSocket client is main-process only. The speak-back spike has accepted cancel-then-commit, so the desktop call may use that path.

The spike must show three things before any call UI:

1. `response.cancel` followed by `speech_text_buffer.commit` speaks host text as `chat_tts_text`, with no `default` audio. The spike used a fixed acknowledgement. The product stays silent on delegate and uses this path for each finished agent block.
2. A later `speech_text_buffer.commit`, with no new user audio, speaks the agent summary as `chat_tts_text`.
3. `conversation.item.input_audio_transcription.started` arrives for speech that starts during playback, and an unsent commit is dropped. Observed on 2026-11-09.

## Phases

1. JSON event codec, event interpretation, and the live spike. No call button.
2. Desktop call on the current session: capture, playback, transcript events, one delegated turn, settings.
3. Barge-in, mute, exit intent, steer-or-queue, and `session.id` resume.

## Out of scope

Phone and CLI Doubao calls, SC role voices, voice cloning, singing, built-in search, external RAG, file input, Opus uplink, and a new harness id.
