package expo.modules.qrscanner

import org.junit.Assert.assertEquals
import org.junit.Test

class QrCoordinatesTest {
  @Test
  fun analysisSizesKeep1080pAndBelow() {
    val sizes = listOf(4000 to 3000, 1920 to 1080, 1280 to 720, 1440 to 1080)
    assertEquals(
      listOf(1920 to 1080, 1280 to 720, 1440 to 1080),
      QrCoordinates.filterSizesByPixels(sizes, Pair<Int, Int>::first, Pair<Int, Int>::second)
    )
  }

  @Test
  fun analysisSizesFallBackToSmallestWhenAllExceed1080p() {
    val sizes = listOf(4000 to 3000, 3840 to 2160)
    assertEquals(
      listOf(3840 to 2160),
      QrCoordinates.filterSizesByPixels(sizes, Pair<Int, Int>::first, Pair<Int, Int>::second)
    )
    assertEquals(
      emptyList<Pair<Int, Int>>(),
      QrCoordinates.filterSizesByPixels(emptyList(), Pair<Int, Int>::first, Pair<Int, Int>::second)
    )
  }

  @Test
  fun fillCenterMapsCroppedPortraitPreviewCoordinates() {
    val mapped = QrCoordinates.toPreviewPoints(
      listOf(96f, 192f, 192f, 288f),
      480,
      640,
      300,
      600,
      false
    )
    assertEquals(listOf(15f, 180f, 105f, 270f), mapped)
  }

  @Test
  fun fitCenterMapsLetterboxedCoordinates() {
    val mapped = QrCoordinates.toPreviewPoints(
      listOf(160f, 160f),
      480,
      640,
      300,
      600,
      true
    )
    assertEquals(listOf(100f, 200f), mapped)
  }

  @Test
  fun barcodePayloadSynthesizesCenteredBoundsWhenVerticesAreMissing() {
    val payload = QrCoordinates.toBarcodePayload("superone://pair?channel=abc", emptyList(), 600, 1200, 2f)
    assertEquals("qr", payload["type"])
    assertEquals("superone://pair?channel=abc", payload["data"])
    val bounds = payload["bounds"] as Map<*, *>
    val size = bounds["size"] as Map<*, *>
    assertEquals(75.0, size["width"])
    assertEquals(75.0, size["height"])
  }

  @Test
  fun clampZoomBoundsTargetToCameraRange() {
    assertEquals(2f, QrCoordinates.clampZoom(2f, 1f, 8f))
    assertEquals(1f, QrCoordinates.clampZoom(0.4f, 1f, 8f))
    assertEquals(6f, QrCoordinates.clampZoom(10f, 1f, 10f))
  }
}
