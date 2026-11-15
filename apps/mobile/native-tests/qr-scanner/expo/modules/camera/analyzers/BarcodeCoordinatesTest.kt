package expo.modules.camera.analyzers

import android.util.Size
import org.junit.Assert.assertEquals
import org.junit.Test

class BarcodeCoordinatesTest {
  @Test fun rotationUsesTheUprightImageDimensions() {
    assertEquals(480 to 640, BarcodeCoordinates.imageSize(640, 480, 90))
    assertEquals(480 to 640, BarcodeCoordinates.imageSize(640, 480, 270))
    assertEquals(640 to 480, BarcodeCoordinates.imageSize(640, 480, 0))
    assertEquals(640 to 480, BarcodeCoordinates.imageSize(640, 480, 180))
  }

  @Test fun fillCenterAccountsForHorizontalCroppingWithoutSwappingAxes() {
    // 480x640 image fills a 300x600 portrait preview: 75 px cropped per side.
    assertEquals(listOf(15, 180, 105, 270), BarcodeCoordinates.toPreview(
      listOf(96, 192, 192, 288), 480, 640, 300, 600, false, false
    ))
  }

  @Test fun landscapeCroppingAndLetterboxingKeepTheirOffsets() {
    assertEquals(listOf(200, 50), BarcodeCoordinates.toPreview(
      listOf(160, 240), 480, 640, 600, 300, false, false
    ))
    assertEquals(listOf(100, 200), BarcodeCoordinates.toPreview(
      listOf(160, 160), 480, 640, 300, 600, true, false
    ))
  }

  @Test fun analysisFramesStayAtOrUnder1080p() {
    val sizes = listOf(Size(4000, 3000), Size(1920, 1080), Size(1280, 720), Size(1440, 1080))
    assertEquals(listOf(Size(1920, 1080), Size(1280, 720), Size(1440, 1080)), BarcodeCoordinates.analysisSizes(sizes))
  }

  @Test fun analysisFallsBackToTheSmallestFrameWhenEverySizeExceeds1080p() {
    val sizes = listOf(Size(4000, 3000), Size(3840, 2160))
    assertEquals(listOf(Size(3840, 2160)), BarcodeCoordinates.analysisSizes(sizes))
    assertEquals(emptyList<Size>(), BarcodeCoordinates.analysisSizes(emptyList()))
  }

  @Test fun mirroredPreviewsFlipOnlyTheHorizontalCoordinate() {
    assertEquals(listOf(285, 180), BarcodeCoordinates.toPreview(
      listOf(96, 192), 480, 640, 300, 600, false, true
    ))
  }
}
