package expo.modules.voiceaudio

import java.util.ArrayDeque

/** Unheard PCM only. Hardware writes are committed after AudioTrack accepts them. */
internal class VoicePcmQueue(private val limit: Int) {
  private val chunks = ArrayDeque<ByteArray>()
  private var offset = 0
  var size = 0
    private set
  fun push(samples: ByteArray) {
    check(size + samples.size <= limit) { "Voice pause buffer is full. End this call and start a new one." }
    chunks.addLast(samples); size += samples.size
  }
  fun peek(output: ByteArray): Int {
    var count = 0
    for (chunk in chunks) {
      val start = if (count == 0) offset else 0
      val n = minOf(output.size - count, chunk.size - start)
      chunk.copyInto(output, count, start, start + n); count += n
      if (count == output.size) break
    }
    return count
  }
  fun consume(accepted: Int) {
    var count = minOf(accepted.coerceAtLeast(0), size)
    size -= count
    while (count > 0) {
      val n = minOf(count, chunks.first.size - offset)
      count -= n; offset += n
      if (offset == chunks.first.size) { chunks.removeFirst(); offset = 0 }
    }
  }
  fun clear() { chunks.clear(); offset = 0; size = 0 }
}
