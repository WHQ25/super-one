package expo.modules.voiceaudio

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class VoiceAudioModule : Module() {
  private var focus: AudioFocusRequest? = null
  private var legacyFocus: AudioManager.OnAudioFocusChangeListener? = null
  private var owner: String? = null
  private val context get() = requireNotNull(appContext.reactContext)
  private val manager get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var focusGeneration = 0
  private fun acquireFocus(): Boolean {
    if (manager.mode == AudioManager.MODE_IN_CALL) return false
    val generation = ++focusGeneration
    val id = owner
    releaseFocus()
    val listener = AudioManager.OnAudioFocusChangeListener { change ->
      if (generation == focusGeneration && change < 0 && VoicePlayback.enabled) {
        VoicePlayback.pause(); sendEvent("onInterruption", mapOf("owner" to id, "reason" to "interrupted"))
      }
      // AUDIOFOCUS_GAIN intentionally never calls resume.
    }
    if (Build.VERSION.SDK_INT < 26) {
      legacyFocus = listener
      @Suppress("DEPRECATION")
      return manager.requestAudioFocus(listener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setWillPauseWhenDucked(true).setOnAudioFocusChangeListener(listener, Handler(Looper.getMainLooper())).build()
    focus = request
    return manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }
  override fun definition() = ModuleDefinition {
    Name("SuperOneVoiceAudio")
    Events("onInterruption", "onBufferError")
    AsyncFunction("start") { id: String ->
      check(owner == null || owner == id) { "Previous voice audio cleanup is pending." }
      owner = id
      VoicePlayback.reset(); VoicePlayback.enabled = true
      VoicePlayback.onOverflow = { sendEvent("onBufferError", mapOf("owner" to id, "message" to "Voice pause buffer is full. End this call and start a new one.")) }
      val service = Intent(context, VoiceCallService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service) else context.startService(service)
      if (!acquireFocus()) { VoicePlayback.pause(); sendEvent("onInterruption", mapOf("owner" to id, "reason" to "interrupted")) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("pause") { id: String -> if (owner == id) VoicePlayback.pause() }.runOnQueue(Queues.MAIN)
    AsyncFunction("resume") { id: String ->
      check(owner == id) { "Voice call is no longer current." }
      check(acquireFocus()) { "Audio is still interrupted. Try again when the other call ends." }
      VoicePlayback.resume()
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { id: String -> if (owner == id) stop() }.runOnQueue(Queues.MAIN)
    OnDestroy { stop() }
  }
  private fun stop() {
    owner = null
    VoicePlayback.reset(); VoicePlayback.onOverflow = null
    focusGeneration++
    if (appContext.reactContext == null) return
    releaseFocus()
    context.stopService(Intent(context, VoiceCallService::class.java))
  }
  private fun releaseFocus() {
    if (Build.VERSION.SDK_INT >= 26) focus?.let { manager.abandonAudioFocusRequest(it) }
    @Suppress("DEPRECATION")
    legacyFocus?.let { manager.abandonAudioFocus(it) }
    focus = null; legacyFocus = null
  }
}
