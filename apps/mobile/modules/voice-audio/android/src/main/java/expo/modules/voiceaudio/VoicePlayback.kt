package expo.modules.voiceaudio

import android.media.AudioRecord
import android.media.AudioTrack
import java.nio.ByteBuffer

/** Intercepts decoded WebRTC PCM, before AudioTrack consumes it. See the build hook. */
object VoicePlayback {
  private val lock = Any()
  private val queue = VoicePcmQueue(48_000 * 2 * 2 * 300)
  private var track: AudioTrack? = null
  private var overflow = false
  @Volatile var enabled = false
  @Volatile var paused = false
    private set
  var onOverflow: (() -> Unit)? = null

  fun pause() = synchronized(lock) {
    paused = true
    // Retain already written but unheard samples in the hardware buffer.
    runCatching { track?.pause() }
  }
  fun resume() = synchronized(lock) { runCatching { track?.play() }.getOrThrow(); paused = false }
  fun reset() = synchronized(lock) {
    enabled = false; paused = false; queue.clear(); track = null; overflow = false
  }

  @JvmStatic fun write(audioTrack: AudioTrack, buffer: ByteBuffer, size: Int, mode: Int): Int {
    if (!enabled) return audioTrack.write(buffer, size, mode)
    var sleepMs = 0L
    val result = synchronized(lock) {
      track = audioTrack
      val incoming = ByteArray(size)
      buffer.duplicate().get(incoming)
      val frameMs = (size * 1000L / (audioTrack.sampleRate * audioTrack.channelCount * 2)).coerceAtLeast(1)
      if (overflow) { sleepMs = frameMs; return@synchronized size }
      // Preserve every paused sample; skip new live silence while draining.
      if (paused || queue.size == 0 || incoming.any { it.toInt() != 0 }) {
        try { queue.push(incoming) } catch (_: IllegalStateException) {
          overflow = true; pause(); onOverflow?.invoke(); sleepMs = frameMs; return@synchronized size
        }
      }
      if (paused) {
        runCatching { audioTrack.pause() }
        sleepMs = frameMs
        size
      } else {
        if (audioTrack.playState != AudioTrack.PLAYSTATE_PLAYING) audioTrack.play()
        val output = ByteArray(size)
        // Peek, then commit only the bytes AudioTrack actually accepted.
        val count = queue.peek(output)
        val written = audioTrack.write(output, 0, size, mode)
        queue.consume(minOf(written, count))
        // The original WebRTC loop owns each decoded block, including on partial
        // hardware writes. Unheard leftovers are already retained in our FIFO.
        if (written < 0) written else size
      }
    }
    if (sleepMs > 0) Thread.sleep(sleepMs)
    return result
  }

  @JvmStatic fun read(record: AudioRecord, buffer: ByteBuffer, size: Int): Int {
    val read = record.read(buffer, size)
    if (enabled && paused && read > 0) for (index in 0 until read) buffer.put(index, 0)
    return read
  }
}
