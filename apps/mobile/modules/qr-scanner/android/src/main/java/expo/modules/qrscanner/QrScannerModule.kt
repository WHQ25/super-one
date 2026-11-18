package expo.modules.qrscanner

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class QrScannerModule : Module() {
  private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

  override fun definition() = ModuleDefinition {
    Name("SuperOneQrScanner")

    AsyncFunction("scanImageAsync") { uri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_QR_CONTEXT", "React context unavailable", null)
        return@AsyncFunction
      }
      scope.launch {
        try {
          val decoded = WeChatQrEngine.decodeImageUri(context, uri)
          val barcodes = decoded.codes.map { code ->
            QrCoordinates.toBarcodePayload(
              code.data,
              code.points,
              decoded.width,
              decoded.height,
              1f
            )
          }
          promise.resolve(
            mapOf(
              "width" to decoded.width,
              "height" to decoded.height,
              "barcodes" to barcodes
            )
          )
        } catch (error: Throwable) {
          promise.reject("ERR_QR_SCAN", error.message ?: "Image QR scan failed", error)
        }
      }
    }

    OnDestroy {
      scope.cancel()
    }

    View(QrScannerCameraView::class) {
      Events("onBarcodesScanned", "onMountError")

      Prop("active") { view: QrScannerCameraView, active: Boolean? ->
        view.setActive(active ?: true)
      }

      Prop("enableTorch") { view: QrScannerCameraView, enabled: Boolean? ->
        view.setEnableTorch(enabled ?: false)
      }

      Prop("zoom") { view: QrScannerCameraView, zoom: Float? ->
        view.setZoom(zoom ?: 1f)
      }

      OnViewDestroys { view: QrScannerCameraView ->
        view.cleanup()
      }
    }
  }
}
