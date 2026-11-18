package expo.modules.qrscanner

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.king.wechat.qrcode.WeChatQRCodeDetector
import org.opencv.OpenCV
import org.opencv.core.Mat
import java.io.File
import java.io.InputStream
import kotlin.math.max

internal data class RawQrCode(val data: String, val points: List<Float>)

internal data class DecodedImageQr(
  val width: Int,
  val height: Int,
  val codes: List<RawQrCode>
)

internal object WeChatQrEngine {
  private const val MAX_IMAGE_DIMENSION = 2560
  private const val QUIET_ZONE_PADDING = 36
  private val lock = Any()
  @Volatile private var initialized = false

  fun ensureInitialized(context: Context) {
    if (initialized) return
    synchronized(lock) {
      if (initialized) return
      OpenCV.initOpenCV()
      WeChatQRCodeDetector.init(context.applicationContext)
      initialized = true
    }
  }

  fun detect(context: Context, bitmap: Bitmap): List<RawQrCode> {
    ensureInitialized(context)
    val mats = ArrayList<Mat>()
    return synchronized(lock) {
      try {
        val texts = WeChatQRCodeDetector.detectAndDecode(bitmap, mats) ?: emptyList()
        texts.mapIndexedNotNull { index, text ->
          if (text.isNullOrEmpty()) null
          else RawQrCode(text, mats.getOrNull(index)?.let(::extractPoints) ?: emptyList())
        }
      } finally {
        mats.forEach { it.release() }
      }
    }
  }

  fun rotateBitmap(source: Bitmap, rotationDegrees: Int): Bitmap {
    val normalized = ((rotationDegrees % 360) + 360) % 360
    if (normalized == 0) return source
    val matrix = Matrix().apply { postRotate(normalized.toFloat()) }
    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, false).also {
      if (it !== source) source.recycle()
    }
  }

  fun decodeImageUri(context: Context, uriString: String): DecodedImageQr {
    val uri = parseUri(uriString)
    val orientation = openStream(context, uri)?.use { stream ->
      runCatching {
        ExifInterface(stream).getAttributeInt(
          ExifInterface.TAG_ORIENTATION,
          ExifInterface.ORIENTATION_NORMAL
        )
      }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    } ?: ExifInterface.ORIENTATION_NORMAL

    val boundsOptions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    openStream(context, uri)?.use { BitmapFactory.decodeStream(it, null, boundsOptions) }
    if (boundsOptions.outWidth <= 0 || boundsOptions.outHeight <= 0) {
      throw IllegalArgumentException("Could not read image dimensions")
    }

    val decodeOptions = BitmapFactory.Options().apply {
      inSampleSize = computeSampleSize(boundsOptions.outWidth, boundsOptions.outHeight)
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decoded = openStream(context, uri)?.use {
      BitmapFactory.decodeStream(it, null, decodeOptions)
    } ?: throw IllegalArgumentException("Could not decode image")

    val upright = applyExifOrientation(decoded, orientation)
    try {
      val direct = detect(context, upright)
      if (direct.isNotEmpty()) {
        return DecodedImageQr(upright.width, upright.height, direct)
      }
      val padded = addQuietZone(upright, QUIET_ZONE_PADDING)
      try {
        val retried = detect(context, padded).map { code ->
          RawQrCode(code.data, code.points.map { it - QUIET_ZONE_PADDING })
        }
        return DecodedImageQr(upright.width, upright.height, retried)
      } finally {
        padded.recycle()
      }
    } finally {
      upright.recycle()
    }
  }

  private fun extractPoints(mat: Mat): List<Float> {
    val coords = ArrayList<Float>(8)
    for (r in 0 until mat.rows()) {
      for (c in 0 until mat.cols()) {
        val values = mat.get(r, c) ?: continue
        for (value in values) {
          coords.add(value.toFloat())
        }
      }
    }
    return coords
  }

  private fun addQuietZone(source: Bitmap, pad: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(
      source.width + pad * 2,
      source.height + pad * 2,
      Bitmap.Config.ARGB_8888
    )
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.WHITE)
    canvas.drawBitmap(source, pad.toFloat(), pad.toFloat(), null)
    return bitmap
  }

  private fun computeSampleSize(width: Int, height: Int): Int {
    var sample = 1
    val longest = max(width, height)
    while (longest / sample > MAX_IMAGE_DIMENSION) {
      sample *= 2
    }
    return sample
  }

  private fun applyExifOrientation(source: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
        matrix.setRotate(180f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.setRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.setRotate(-90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
      else -> return source
    }
    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, false).also {
      if (it !== source) source.recycle()
    }
  }

  private fun parseUri(raw: String): Uri =
    if (raw.startsWith("/")) Uri.fromFile(File(raw)) else Uri.parse(raw)

  private fun openStream(context: Context, uri: Uri): InputStream? =
    context.contentResolver.openInputStream(uri)
}
