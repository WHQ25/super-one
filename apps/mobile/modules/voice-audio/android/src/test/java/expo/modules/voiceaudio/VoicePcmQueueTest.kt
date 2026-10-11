package expo.modules.voiceaudio

import org.junit.Assert.*
import org.junit.Test

class VoicePcmQueueTest {
  @Test fun retainsUnheardPartialHardwareWritesAndPausedArrivals() {
    val queue = VoicePcmQueue(20)
    queue.push(byteArrayOf(1, 2, 3))
    val first = ByteArray(2); assertEquals(2, queue.peek(first)); queue.consume(1)
    // The hardware accepted only sample 1; repeated peeks and new arrivals
    // must retain sample 2 at the playback cursor.
    queue.push(byteArrayOf(4, 5)); queue.push(byteArrayOf(6))
    val resumed = ByteArray(5); assertEquals(5, queue.peek(resumed))
    assertArrayEquals(byteArrayOf(2, 3, 4, 5, 6), resumed)
    queue.consume(5); assertEquals(0, queue.size)
  }
  @Test fun overflowNeverOverwritesUnheardAudioAndClearStartsAnEmptyCall() {
    val queue = VoicePcmQueue(3); queue.push(byteArrayOf(1, 2, 3))
    assertThrows(IllegalStateException::class.java) { queue.push(byteArrayOf(4)) }
    val retained = ByteArray(3); queue.peek(retained); assertArrayEquals(byteArrayOf(1, 2, 3), retained)
    queue.clear(); assertEquals(0, queue.size)
    queue.push(byteArrayOf(8)); val fresh = ByteArray(1); queue.peek(fresh); assertArrayEquals(byteArrayOf(8), fresh)
  }
}
