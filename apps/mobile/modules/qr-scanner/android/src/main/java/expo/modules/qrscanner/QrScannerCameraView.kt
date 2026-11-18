package expo.modules.qrscanner

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.os.SystemClock
import android.util.Log
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.Surface
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SuppressLint("ViewConstructor")
class QrScannerCameraView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onBarcodesScanned by EventDispatcher<Map<String, Any>>()
  private val onMountError by EventDispatcher<Map<String, Any>>()

  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }

  private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())
  private val analysisExecutor = Executors.newSingleThreadExecutor()
  private var cameraProvider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var imageAnalysis: ImageAnalysis? = null
  private var boundUseCases: Array<UseCase> = emptyArray()
  private var refocusJob: Job? = null
  private var bindingGeneration = 0
  private var cleanedUp = false
  private var activeProp = true
  private var torchProp = false
  private var zoomProp = 1f
  private var lastManualFocusAt = 0L

  private val displayListener = object : DisplayManager.DisplayListener {
    override fun onDisplayAdded(displayId: Int) = Unit
    override fun onDisplayRemoved(displayId: Int) = Unit
    override fun onDisplayChanged(displayId: Int) {
      if (previewView.display?.displayId == displayId) {
        imageAnalysis?.targetRotation = currentDisplayRotation()
      }
    }
  }

  private val scaleDetector = ScaleGestureDetector(
    context,
    object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScale(detector: ScaleGestureDetector): Boolean {
        val info = camera?.cameraInfo?.zoomState?.value ?: return false
        val target = QrCoordinates.clampZoom(
          info.zoomRatio * detector.scaleFactor,
          info.minZoomRatio,
          info.maxZoomRatio
        )
        camera?.cameraControl?.setZoomRatio(target)
        return true
      }
    }
  )

  private val gestureDetector = GestureDetector(
    context,
    object : GestureDetector.SimpleOnGestureListener() {
      override fun onSingleTapUp(e: MotionEvent): Boolean {
        lastManualFocusAt = SystemClock.uptimeMillis()
        focusAt(e.x, e.y, 4L)
        return true
      }

      override fun onDoubleTap(e: MotionEvent): Boolean {
        val info = camera?.cameraInfo?.zoomState?.value ?: return false
        val next = if (info.zoomRatio > 1.4f) 1f else 2f
        val clamped = QrCoordinates.clampZoom(next, info.minZoomRatio, info.maxZoomRatio)
        camera?.cameraControl?.setZoomRatio(clamped)
        return true
      }
    }
  )

  init {
    addView(previewView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    analysisExecutor.execute {
      runCatching { WeChatQrEngine.ensureInitialized(context) }
    }
  }

  fun setActive(value: Boolean) {
    if (activeProp == value) return
    activeProp = value
    syncCameraState()
  }

  fun setEnableTorch(value: Boolean) {
    torchProp = value
    applyTorch()
  }

  fun setZoom(value: Float) {
    if (zoomProp == value) return
    zoomProp = value
    applyZoom(value)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
    displayManager?.registerDisplayListener(displayListener, handler)
    syncCameraState()
  }

  override fun onDetachedFromWindow() {
    val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
    displayManager?.unregisterDisplayListener(displayListener)
    unbindCamera()
    super.onDetachedFromWindow()
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    val w = r - l
    val h = b - t
    if (w > 0 && h > 0) {
      previewView.measure(
        MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY),
        MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY)
      )
      previewView.layout(0, 0, w, h)
      imageAnalysis?.targetRotation = currentDisplayRotation()
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    val scaled = scaleDetector.onTouchEvent(event)
    val tapped = if (!scaleDetector.isInProgress) gestureDetector.onTouchEvent(event) else false
    return scaled || tapped || super.onTouchEvent(event) || true
  }

  fun cleanup() {
    if (cleanedUp) return
    cleanedUp = true
    unbindCamera()
    scope.cancel()
    analysisExecutor.shutdown()
  }

  private fun syncCameraState() {
    if (cleanedUp) return
    if (isAttachedToWindow && activeProp) {
      val generation = ++bindingGeneration
      scope.launch { bindCamera(generation) }
    } else {
      bindingGeneration++
      unbindCamera()
    }
  }

  private suspend fun bindCamera(generation: Int) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      onMountError(mapOf("message" to "Camera permission not granted"))
      return
    }
    try {
      val provider = ProcessCameraProvider.awaitInstance(context)
      if (cleanedUp || !isAttachedToWindow || !activeProp || generation != bindingGeneration) return
      val owner = appContext.currentActivity as? LifecycleOwner
        ?: throw IllegalStateException("Missing LifecycleOwner activity")

      cameraProvider = provider
      unbindBoundUseCases(provider)

      val preview = Preview.Builder()
        .setResolutionSelector(
          ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
            .build()
        )
        .build()
        .also { it.surfaceProvider = previewView.surfaceProvider }

      val analysis = ImageAnalysis.Builder()
        .setResolutionSelector(
          ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
            .setResolutionFilter { sizes, _ -> QrCoordinates.analysisSizes(sizes) }
            .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
            .build()
        )
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .setTargetRotation(currentDisplayRotation())
        .build()
        .also { it.setAnalyzer(analysisExecutor, ::analyzeFrame) }

      val selector = CameraSelector.Builder()
        .requireLensFacing(CameraSelector.LENS_FACING_BACK)
        .build()

      boundUseCases = arrayOf(preview, analysis)
      imageAnalysis = analysis
      val boundCamera = provider.bindToLifecycle(owner, selector, preview, analysis)
      camera = boundCamera
      applyZoom(zoomProp)
      observeCameraOpen(boundCamera, owner)
      startPeriodicCenterRefocus()
    } catch (error: Exception) {
      if (generation == bindingGeneration && !cleanedUp) {
        onMountError(mapOf("message" to (error.message ?: error.javaClass.simpleName)))
      }
    }
  }

  private fun observeCameraOpen(boundCamera: Camera, owner: LifecycleOwner) {
    boundCamera.cameraInfo.cameraState.observe(owner) { state ->
      if (camera !== boundCamera || cleanedUp) return@observe
      if (state.type == CameraState.Type.OPEN) {
        applyTorch()
        applyZoom(zoomProp)
        focusCenter()
      }
    }
  }

  private fun startPeriodicCenterRefocus() {
    refocusJob?.cancel()
    refocusJob = scope.launch {
      while (isActive && activeProp && !cleanedUp) {
        delay(3500L)
        if (SystemClock.uptimeMillis() - lastManualFocusAt >= 4000L) {
          focusCenter()
        }
      }
    }
  }

  private fun focusCenter() {
    val w = previewView.width
    val h = previewView.height
    if (w > 0 && h > 0) {
      focusAt(w / 2f, h / 2f, 3L)
    }
  }

  private fun focusAt(x: Float, y: Float, cancelSeconds: Long) {
    val cam = camera ?: return
    if (previewView.width <= 0 || previewView.height <= 0) return
    runCatching {
      val point = previewView.meteringPointFactory.createPoint(x, y)
      val action = FocusMeteringAction.Builder(
        point,
        FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE
      )
        .setAutoCancelDuration(cancelSeconds, TimeUnit.SECONDS)
        .build()
      cam.cameraControl.startFocusAndMetering(action)
    }
  }

  private fun applyTorch() {
    val cam = camera ?: return
    if (cam.cameraInfo.hasFlashUnit()) {
      cam.cameraControl.enableTorch(torchProp)
    }
  }

  private fun applyZoom(targetRatio: Float) {
    val cam = camera ?: return
    val state = cam.cameraInfo.zoomState.value
    val clamped = if (state != null) {
      QrCoordinates.clampZoom(targetRatio, state.minZoomRatio, state.maxZoomRatio)
    } else {
      targetRatio.coerceAtLeast(1f)
    }
    cam.cameraControl.setZoomRatio(clamped)
  }

  private fun analyzeFrame(imageProxy: ImageProxy) {
    val rotation = imageProxy.imageInfo.rotationDegrees
    val rawBitmap = try {
      imageProxy.toBitmap()
    } catch (error: Throwable) {
      Log.w("SuperOneQrScanner", "Frame conversion failed: ${error.message}")
      null
    } finally {
      imageProxy.close()
    } ?: return

    val upright = try {
      WeChatQrEngine.rotateBitmap(rawBitmap, rotation)
    } catch (error: Throwable) {
      rawBitmap.recycle()
      return
    }

    val imageWidth = upright.width
    val imageHeight = upright.height
    val codes = try {
      WeChatQrEngine.detect(context, upright)
    } catch (error: Throwable) {
      Log.w("SuperOneQrScanner", "QR detection failed: ${error.message}")
      emptyList()
    } finally {
      upright.recycle()
    }

    if (codes.isEmpty() || cleanedUp) return

    post {
      if (cleanedUp || !isAttachedToWindow || !activeProp) return@post
      val viewWidth = previewView.width
      val viewHeight = previewView.height
      if (viewWidth <= 0 || viewHeight <= 0) return@post
      val density = resources.displayMetrics.density
      val fitCenter = previewView.scaleType == PreviewView.ScaleType.FIT_CENTER
      val payloads = codes.map { code ->
        val mapped = QrCoordinates.toPreviewPoints(
          code.points,
          imageWidth,
          imageHeight,
          viewWidth,
          viewHeight,
          fitCenter
        )
        QrCoordinates.toBarcodePayload(code.data, mapped, viewWidth, viewHeight, density)
      }
      onBarcodesScanned(mapOf("barcodes" to payloads))
    }
  }

  private fun unbindCamera() {
    refocusJob?.cancel()
    refocusJob = null
    imageAnalysis?.clearAnalyzer()
    imageAnalysis = null
    camera = null
    cameraProvider?.let(::unbindBoundUseCases)
  }

  private fun unbindBoundUseCases(provider: ProcessCameraProvider) {
    if (boundUseCases.isNotEmpty()) {
      runCatching { provider.unbind(*boundUseCases) }
      boundUseCases = emptyArray()
    }
  }

  private fun currentDisplayRotation(): Int =
    previewView.display?.rotation ?: Surface.ROTATION_0
}
