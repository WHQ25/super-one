package expo.modules.qrscanner

import android.util.Size
import kotlin.math.max
import kotlin.math.min

internal object QrCoordinates {
  private const val MAX_ANALYSIS_PIXELS = 1920L * 1080L

  fun analysisSizes(sizes: List<Size>): List<Size> =
    filterSizesByPixels(sizes, Size::getWidth, Size::getHeight)

  internal fun <T> filterSizesByPixels(
    sizes: List<T>,
    widthOf: (T) -> Int,
    heightOf: (T) -> Int
  ): List<T> {
    if (sizes.isEmpty()) return sizes
    val within = sizes.filter { widthOf(it).toLong() * heightOf(it) <= MAX_ANALYSIS_PIXELS }
    if (within.isNotEmpty()) return within
    return listOf(sizes.minBy { widthOf(it).toLong() * heightOf(it) })
  }

  fun toPreviewPoints(
    points: List<Float>,
    imageWidth: Int,
    imageHeight: Int,
    previewWidth: Int,
    previewHeight: Int,
    fitCenter: Boolean
  ): List<Float> {
    if (imageWidth <= 0 || imageHeight <= 0 || previewWidth <= 0 || previewHeight <= 0) {
      return emptyList()
    }
    val scaleX = previewWidth.toFloat() / imageWidth
    val scaleY = previewHeight.toFloat() / imageHeight
    val scale = if (fitCenter) min(scaleX, scaleY) else max(scaleX, scaleY)
    val offsetX = (previewWidth - imageWidth * scale) / 2f
    val offsetY = (previewHeight - imageHeight * scale) / 2f
    val mapped = ArrayList<Float>(points.size)
    var i = 0
    while (i + 1 < points.size) {
      mapped.add(points[i] * scale + offsetX)
      mapped.add(points[i + 1] * scale + offsetY)
      i += 2
    }
    return mapped
  }

  fun toBarcodePayload(
    data: String,
    points: List<Float>,
    surfaceWidth: Int,
    surfaceHeight: Int,
    density: Float
  ): Map<String, Any> {
    val safeDensity = if (density > 0f) density else 1f
    if (points.size >= 6) {
      val cornerPoints = ArrayList<Map<String, Double>>(points.size / 2)
      var minX = Float.POSITIVE_INFINITY
      var minY = Float.POSITIVE_INFINITY
      var maxX = Float.NEGATIVE_INFINITY
      var maxY = Float.NEGATIVE_INFINITY
      var i = 0
      while (i + 1 < points.size) {
        val x = points[i] / safeDensity
        val y = points[i + 1] / safeDensity
        minX = min(minX, x)
        minY = min(minY, y)
        maxX = max(maxX, x)
        maxY = max(maxY, y)
        cornerPoints.add(mapOf("x" to x.toDouble(), "y" to y.toDouble()))
        i += 2
      }
      val width = max(1f, maxX - minX)
      val height = max(1f, maxY - minY)
      return mapOf(
        "type" to "qr",
        "data" to data,
        "cornerPoints" to cornerPoints,
        "bounds" to mapOf(
          "origin" to mapOf("x" to minX.toDouble(), "y" to minY.toDouble()),
          "size" to mapOf("width" to width.toDouble(), "height" to height.toDouble())
        )
      )
    }
    val w = max(1f, surfaceWidth / safeDensity)
    val h = max(1f, surfaceHeight / safeDensity)
    val side = max(44f, min(w, h) * 0.25f)
    val originX = (w - side) / 2f
    val originY = (h - side) / 2f
    return mapOf(
      "type" to "qr",
      "data" to data,
      "cornerPoints" to emptyList<Map<String, Double>>(),
      "bounds" to mapOf(
        "origin" to mapOf("x" to originX.toDouble(), "y" to originY.toDouble()),
        "size" to mapOf("width" to side.toDouble(), "height" to side.toDouble())
      )
    )
  }

  fun clampZoom(target: Float, minZoom: Float, maxZoom: Float): Float {
    val low = max(0.5f, minZoom)
    val high = max(low, min(maxZoom, 6f))
    return target.coerceIn(low, high)
  }
}
