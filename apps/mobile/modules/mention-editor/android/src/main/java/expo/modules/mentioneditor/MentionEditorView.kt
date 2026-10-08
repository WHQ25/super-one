package expo.modules.mentioneditor

import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Canvas
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.SystemClock
import android.text.Editable
import android.text.Spannable
import android.text.SpannableString
import android.text.TextPaint
import android.text.TextWatcher
import android.text.StaticLayout
import android.text.Layout
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.view.inputmethod.BaseInputConnection
import android.widget.EditText
import android.util.Base64
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** Feasibility view: native edits own the text and spans. JS sends explicit,
 * event-count-checked commands, never a controlled value on every keystroke. */
class MentionEditorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onDocumentChange by EventDispatcher<Map<String, Any?>>()
  private val onContentHeightChange by EventDispatcher<Map<String, Any>>()
  private val onSubmit by EventDispatcher<Map<String, Any>>()
  private val onMentionPress by EventDispatcher<Map<String, Any>>()
  /** The chip a touch went down on, and where; a tap that ends on it opens its preview. */
  private var chipDown: ChipHit? = null
  private var downX = 0f
  private var downY = 0f
  private var submitOnReturn = false
  private var lastContentHeight = 0
  private var eventCount = 0
  private var lastCommand = -1
  private var changing = false
  private var mutedForeground = Color.GRAY
  private var blendedKinds = emptySet<String>()
  private var pasteChrome = emptyMap<String, Double>()
  private var chipColor = Color.TRANSPARENT
  private var artwork = emptyMap<String, Bitmap>()
  private var keywordAnimate = false
  private var keywordStepMs = 50
  private var keywordSteps = 30
  private var keywordBand = 3
  private var keywordStep = -1L
  private var shimmerRunning = false
  /** The draft's keywords render in pixel capitals (`fonts/`, see scripts/build-font.py). */
  private val keywordTypeface: Typeface? by lazy {
    try { Typeface.createFromAsset(context.assets, "superone-keyword-pixel.ttf") } catch (_: RuntimeException) { null }
  }
  private val shimmerTick = object : Runnable {
    override fun run() {
      if (!shimmerRunning) return
      val step = SystemClock.uptimeMillis() / keywordStepMs
      if (step != keywordStep) recolorKeywords(step)
      editor.postDelayed(this, keywordStepMs - SystemClock.uptimeMillis() % keywordStepMs)
    }
  }
  private val editor = object : EditText(context) {
    override fun onTextContextMenuItem(id: Int): Boolean {
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      val value = text ?: return super.onTextContextMenuItem(id)
      val start = minOf(selectionStart, selectionEnd).coerceAtLeast(0)
      val end = maxOf(selectionStart, selectionEnd).coerceAtLeast(start)
      when (id) {
        android.R.id.copy, android.R.id.cut -> {
          clipboard.setPrimaryClip(ClipData.newPlainText("", plainText(start, end)))
          if (id == android.R.id.cut) value.delete(start, end)
          return true
        }
        android.R.id.paste, android.R.id.pasteAsPlainText -> {
          val clip = clipboard.primaryClip ?: return true
          val pasted = (0 until clip.itemCount).joinToString("\n") {
            clip.getItemAt(it).coerceToText(context).toString()
          }.replace('\uFFFC', '\uFFFD')
          if (pasted.isBlank()) { value.replace(start, end, pasted); setSelection(start + pasted.length) }
          else insertPaste(start, end, pasted)
          return true
        }
      }
      return super.onTextContextMenuItem(id)
    }
    // A tap on a chip opens its preview. The EditText gets a cancel instead of the up, so
    // it neither places the caret nor raises the keyboard, which would move the composer
    // under the preview and close it. Drags and long presses stay the EditText's.
    override fun onTouchEvent(event: MotionEvent): Boolean {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> { chipDown = chipAt(event.x, event.y); downX = event.x; downY = event.y }
        MotionEvent.ACTION_UP -> {
          val down = chipDown
          chipDown = null
          val slop = ViewConfiguration.get(context).scaledTouchSlop
          if (down != null && kotlin.math.hypot(event.x - downX, event.y - downY) < slop && chipAt(event.x, event.y)?.offset == down.offset
            && event.eventTime - event.downTime < ViewConfiguration.getLongPressTimeout()) {
            val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
            super.onTouchEvent(cancel)
            cancel.recycle()
            pressChip(down)
            return true
          }
        }
        MotionEvent.ACTION_CANCEL -> chipDown = null
      }
      return super.onTouchEvent(event)
    }
    override fun onSelectionChanged(start: Int, end: Int) {
      super.onSelectionChanged(start, end)
      // Android invokes this from the EditText constructor as well.
      post { if (!changing) publish() }
    }
  }

  init {
    editor.gravity = Gravity.TOP or Gravity.START
    editor.textSize = 15f
    editor.setSingleLine(false)
    editor.setOnEditorActionListener { _, action, event ->
      val value = editor.text
      val enter = event?.keyCode == KeyEvent.KEYCODE_ENTER
      if (!submitOnReturn || !editor.isEnabled || value == null || BaseInputConnection.getComposingSpanStart(value) >= 0
        || event?.isShiftPressed == true || (action != EditorInfo.IME_ACTION_SEND && !enter)) false
      else {
        if (event == null || (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0)) onSubmit(mapOf("eventCount" to eventCount))
        true
      }
    }
    editor.background = null
    applyImeOptions()
    editor.hint = "Ask anything…"
    val density = resources.displayMetrics.density
    editor.setPadding((12 * density).toInt(), (10 * density).toInt(), (12 * density).toInt(), (10 * density).toInt())
    editor.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> publishContentHeight() }
    addView(editor, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    editor.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
      override fun afterTextChanged(value: Editable?) { if (!changing) { eventCount++; publish() } }
    })
  }

  fun setForeground(color: String) { editor.setTextColor(Color.parseColor(color)); editor.setHintTextColor(mutedForeground) }
  fun setChipBackground(color: String) { chipColor = Color.parseColor(color); refreshChipSpans() }

  /**
   * IME flags for the editor. Applied at construction as well, because the
   * `submitOnReturn` prop may never change from its default and the flags must
   * not depend on that.
   *
   * `IME_FLAG_NO_FULLSCREEN` matters in landscape: without it most keyboards
   * enter fullscreen mode and cover the whole window, and since
   * `IME_FLAG_NO_EXTRACT_UI` also hides the keyboard's own text field the user
   * can't see what they type. React Native's TextInput sets the same flag.
   */
  private fun applyImeOptions() {
    editor.imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN or EditorInfo.IME_FLAG_NO_EXTRACT_UI or
      (if (submitOnReturn) EditorInfo.IME_ACTION_SEND else EditorInfo.IME_FLAG_NO_ENTER_ACTION)
  }

  fun setSubmitOnReturn(value: Boolean) {
    if (submitOnReturn == value) return
    submitOnReturn = value
    applyImeOptions()
    if (editor.hasFocus()) {
      val keyboard = context.getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
      keyboard.restartInput(editor)
    }
  }
  fun setEditable(value: Boolean) {
    editor.isEnabled = value
    if (!value) {
      val keyboard = context.getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
      keyboard.hideSoftInputFromWindow(editor.windowToken, 0)
      editor.clearFocus()
    }
  }
  fun setPlaceholder(value: String) { editor.hint = value }
  fun setEditorLabel(value: String) { editor.contentDescription = value }
  fun setMutedForeground(color: String) { mutedForeground = Color.parseColor(color); editor.setHintTextColor(mutedForeground); refreshChipSpans() }
  fun setBlendedKinds(kinds: List<String>) { blendedKinds = kinds.toSet(); refreshChipSpans() }
  fun setPasteChrome(value: Map<String, Double>) { pasteChrome = value; refreshChipSpans() }

  fun setArtwork(images: List<Map<String, String>>) {
    artwork = images.mapNotNull { image ->
      val key = image["key"] ?: return@mapNotNull null
      val png = image["png"] ?: return@mapNotNull null
      try {
        val bytes = Base64.decode(png, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { key to it }
      } catch (_: IllegalArgumentException) { null }
    }.toMap()
    refreshChipSpans()
  }

  /** TextView caches text-line display lists. invalidate()/requestLayout() alone
   * do not invalidate a ReplacementSpan's measured width or recorded drawing.
   * Notify its SpanWatcher without replacing text, selection or composing spans. */
  private fun refreshChipSpans() {
    val value = editor.text ?: return
    val wasChanging = changing
    changing = true
    try {
      for (span in value.getSpans(0, value.length, ChipSpan::class.java)) {
        val start = value.getSpanStart(span)
        val end = value.getSpanEnd(span)
        val flags = value.getSpanFlags(span)
        value.removeSpan(span)
        value.setSpan(ChipSpan(span.kind, span.value, span.label), start, end, flags)
      }
    } finally { changing = wasChanging }
    editor.requestLayout()
    editor.invalidate()
    editor.post { publishContentHeight() }
  }

  private fun plainText(start: Int, end: Int): String {
    val value = editor.text ?: return ""
    val spans = value.getSpans(start, end, ChipSpan::class.java).associateBy { value.getSpanStart(it) }
    return buildString {
      for (offset in start until end) {
        val span = spans[offset]
        if (span == null) append(value[offset])
        else if (span.kind == "paste") append('\n').append(span.value).append('\n')
        else {
          val label = when (span.kind) {
            "file", "agent" -> span.value
            "directory" -> span.value.trimEnd('/') + "/"
            else -> span.label
          }
          append('@').append(label)
        }
      }
    }
  }

  private fun insertPaste(start: Int, end: Int, text: String) {
    val value = editor.text ?: return
    if (!editor.isEnabled) return
    val collapsed = text.replace(Regex("\\s+"), " ").trim()
    val chars = collapsed.codePoints().limit(41).toArray()
    val label = String(chars, 0, minOf(chars.size, 40)) + if (chars.size > 40) "…" else ""
    val replacement = SpannableString("\uFFFC")
    replacement.setSpan(ChipSpan("paste", text, label), 0, 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    changing = true
    editor.beginBatchEdit()
    BaseInputConnection.removeComposingSpans(value)
    value.replace(start, end, replacement)
    editor.setSelection(start + 1)
    editor.endBatchEdit()
    changing = false
    eventCount++
    publish()
  }

  fun applyCommand(command: Map<String, Any?>) {
    val id = (command["id"] as? Number)?.toInt() ?: return
    if (id <= lastCommand) return
    lastCommand = id
    val value = editor.text ?: return
    if (command["action"] == "prepareSubmit") {
      BaseInputConnection.removeComposingSpans(value)
      (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.restartInput(editor)
      publish(submissionId = id)
      return
    }
    val expected = (command["eventCount"] as? Number)?.toInt() ?: return
    if (expected != eventCount || BaseInputConnection.getComposingSpanStart(value) >= 0) {
      publish("stale-or-composing")
      return
    }
    val start = (command["start"] as? Number)?.toInt() ?: return
    val end = (command["end"] as? Number)?.toInt() ?: return
    if (start < 0 || end < start || end > value.length) return
    val text = command["text"] as? String ?: ""
    val replacement = SpannableString(text)
    val tokens = command["tokens"] as? List<*> ?: emptyList<Any>()
    for (raw in tokens) {
      val token = raw as? Map<*, *> ?: continue
      val offset = (token["offset"] as? Number)?.toInt() ?: continue
      val kind = token["kind"] as? String ?: continue
      val path = token["value"] as? String ?: continue
      val label = token["displayName"] as? String ?: path
      if (offset !in text.indices || text[offset] != '\uFFFC') continue
      replacement.setSpan(ChipSpan(kind, path, label), offset, offset + 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    changing = true
    value.replace(start, end, replacement)
    editor.setSelection(start + replacement.length)
    changing = false
    eventCount++
    publish()
  }

  /**
   * Paints the draft's prompt keywords: JS's `KeywordHighlight`, for the draft
   * with this `eventCount` only. A later keystroke gets its own highlight next.
   */
  fun setKeywords(value: Map<String, Any?>) {
    val text = editor.text ?: return
    val expected = (value["eventCount"] as? Number)?.toInt() ?: return
    if (expected != eventCount || BaseInputConnection.getComposingSpanStart(text) >= 0) return
    keywordAnimate = value["animate"] as? Boolean ?: false
    keywordStepMs = ((value["stepMs"] as? Number)?.toInt() ?: keywordStepMs).coerceAtLeast(1)
    keywordSteps = ((value["steps"] as? Number)?.toInt() ?: keywordSteps).coerceAtLeast(1)
    keywordBand = (value["band"] as? Number)?.toInt() ?: keywordBand
    val step = if (keywordAnimate) SystemClock.uptimeMillis() / keywordStepMs else -1L
    keywordStep = step
    val wasChanging = changing
    changing = true
    try {
      for (span in text.getSpans(0, text.length, KeywordSpan::class.java)) text.removeSpan(span)
      for (raw in value["letters"] as? List<*> ?: emptyList<Any>()) {
        val letter = raw as? Map<*, *> ?: continue
        val offset = (letter["offset"] as? Number)?.toInt() ?: continue
        val index = (letter["index"] as? Number)?.toInt() ?: continue
        val color = (letter["color"] as? String)?.let(Color::parseColor) ?: continue
        val shimmer = (letter["shimmer"] as? String)?.let(Color::parseColor) ?: continue
        if (offset !in text.indices || text[offset] == '\uFFFC') continue
        text.setSpan(KeywordSpan(index, color, shimmer, lit(index, step)), offset, offset + 1, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    } finally { changing = wasChanging }
    updateShimmer()
  }

  private fun lit(index: Int, step: Long): Boolean {
    if (step < 0) return false
    val phase = Math.floorMod(step - index, keywordSteps.toLong())
    return phase < keywordBand
  }

  /** Re-sets only the letters the band entered or left: TextView redraws a span's line on a span change, not on invalidate(). */
  private fun recolorKeywords(step: Long) {
    val text = editor.text ?: return
    keywordStep = step
    if (BaseInputConnection.getComposingSpanStart(text) >= 0) return
    val wasChanging = changing
    changing = true
    try {
      for (span in text.getSpans(0, text.length, KeywordSpan::class.java)) {
        val next = lit(span.index, step)
        if (next == span.lit) continue
        val start = text.getSpanStart(span)
        val end = text.getSpanEnd(span)
        val flags = text.getSpanFlags(span)
        text.removeSpan(span)
        text.setSpan(KeywordSpan(span.index, span.color, span.shimmer, next), start, end, flags)
      }
    } finally { changing = wasChanging }
  }

  private fun updateShimmer() {
    val text = editor.text
    val running = keywordAnimate && isAttachedToWindow && text != null && text.getSpans(0, text.length, KeywordSpan::class.java).isNotEmpty()
    if (running == shimmerRunning) return
    shimmerRunning = running
    editor.removeCallbacks(shimmerTick)
    if (running) editor.post(shimmerTick)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    updateShimmer()
  }

  override fun onDetachedFromWindow() {
    shimmerRunning = false
    editor.removeCallbacks(shimmerTick)
    super.onDetachedFromWindow()
  }

  /** A keyword letter: pixel capitals at 16/15 of the text size, in its rest or shimmer colour. */
  private inner class KeywordSpan(val index: Int, val color: Int, val shimmer: Int, val lit: Boolean) : MetricAffectingSpan() {
    override fun updateMeasureState(paint: TextPaint) {
      keywordTypeface?.let { paint.typeface = it }
      paint.textSize = editor.textSize * 16f / 15f
    }
    override fun updateDrawState(paint: TextPaint) {
      updateMeasureState(paint)
      paint.color = if (lit) shimmer else color
    }
  }

  private class ChipHit(val offset: Int, val span: ChipSpan, val left: Float, val top: Float, val right: Float, val bottom: Float)

  /** The chip drawn under a point in the editor's own coordinates, framed in the same space. */
  private fun chipAt(x: Float, y: Float): ChipHit? {
    val layout = editor.layout ?: return null
    val value = editor.text ?: return null
    val lx = x - editor.totalPaddingLeft + editor.scrollX
    val ly = y - editor.totalPaddingTop + editor.scrollY
    val line = layout.getLineForVertical(ly.toInt())
    if (ly < layout.getLineTop(line) || ly > layout.getLineBottom(line)) return null
    val nearest = layout.getOffsetForHorizontal(line, lx)
    for (offset in listOf(nearest, nearest - 1)) {
      if (offset < layout.getLineStart(line) || offset >= layout.getLineEnd(line)) continue
      val span = value.getSpans(offset, offset + 1, ChipSpan::class.java).firstOrNull { value.getSpanStart(it) == offset } ?: continue
      val left = layout.getPrimaryHorizontal(offset)
      val right = if (offset + 1 < layout.getLineEnd(line)) layout.getPrimaryHorizontal(offset + 1) else layout.getLineRight(line)
      if (lx < minOf(left, right) || lx > maxOf(left, right)) continue
      val dx = editor.totalPaddingLeft - editor.scrollX.toFloat()
      val dy = editor.totalPaddingTop - editor.scrollY.toFloat()
      return ChipHit(offset, span, minOf(left, right) + dx, layout.getLineTop(line) + dy, maxOf(left, right) + dx, layout.getLineBottom(line) + dy)
    }
    return null
  }

  private fun pressChip(hit: ChipHit) {
    val density = resources.displayMetrics.density
    onMentionPress(mapOf("offset" to hit.offset, "kind" to hit.span.kind, "value" to hit.span.value, "displayName" to hit.span.label,
      "x" to (editor.left + hit.left) / density, "y" to (editor.top + hit.top) / density,
      "width" to (hit.right - hit.left) / density, "height" to (hit.bottom - hit.top) / density))
  }

  private fun publishContentHeight() {
    val layout = editor.layout ?: return
    val pixels = layout.height + editor.compoundPaddingTop + editor.compoundPaddingBottom
    if (pixels <= 0 || pixels == lastContentHeight) return
    lastContentHeight = pixels
    onContentHeightChange(mapOf("height" to pixels / resources.displayMetrics.density))
  }

  private fun publish(rejection: String? = null, submissionId: Int? = null) {
    editor.post { publishContentHeight() }
    val value = editor.text ?: return
    val tokens = value.getSpans(0, value.length, ChipSpan::class.java).mapNotNull { span ->
      val offset = value.getSpanStart(span)
      if (offset < 0 || offset >= value.length || value[offset] != '\uFFFC') null
      else mapOf("kind" to span.kind, "value" to span.value, "displayName" to span.label, "offset" to offset)
    }
    val event = mutableMapOf<String, Any?>("text" to value.toString(), "tokens" to tokens,
      "eventCount" to eventCount, "start" to editor.selectionStart, "end" to editor.selectionEnd,
      "composing" to (BaseInputConnection.getComposingSpanStart(value) >= 0), "rejection" to rejection, "supportsPrepareSubmit" to true)
    if (submissionId != null) event["submissionId"] = submissionId
    onDocumentChange(event)
  }

  private inner class ChipSpan(val kind: String, val value: String, val label: String) : ReplacementSpan() {
    private val blended get() = kind in blendedKinds
    private fun metric(name: String, fallback: Float) = if (kind == "paste") pasteChrome[name]?.toFloat() ?: fallback else fallback
    private val margin get() = editor.textSize * metric("marginEm", if (blended) 0.25f else 0.125f)
    private val padding get() = editor.textSize * metric("paddingEm", if (blended) 0f else 0.35f)
    private val icon get() = artwork[if (kind == "paste") "paste" else "$kind:$value"]
    private val iconSize get() = editor.textSize * metric("iconSizeEm", 1f)
    private val iconWidth get() = if (icon != null) iconSize + editor.textSize * metric("iconGapEm", 0.25f) else 0f
    private fun pasteLayout(paint: Paint): StaticLayout? {
      if (kind != "paste") return null
      val available = if (editor.width <= 0) paint.measureText(label) else
        (editor.width - editor.totalPaddingLeft - editor.totalPaddingRight - (padding + margin) * 2 - iconWidth).coerceAtLeast(1f)
      val width = kotlin.math.ceil(minOf(paint.measureText(label), available)).toInt().coerceAtLeast(1)
      return StaticLayout.Builder.obtain(label, 0, label.length, TextPaint(paint), width)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).build()
    }
    override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
      val layout = pasteLayout(paint)
      if (fm != null) {
        val metrics = paint.fontMetricsInt
        fm.ascent = metrics.ascent; fm.descent = metrics.descent
        if (layout != null) fm.descent += maxOf(0, layout.height - (metrics.descent - metrics.ascent))
        fm.top = metrics.top; fm.bottom = maxOf(metrics.bottom, fm.descent); fm.leading = metrics.leading
      }
      return kotlin.math.ceil((layout?.width?.toFloat() ?: paint.measureText(label)) + (padding + margin) * 2 + iconWidth).toInt()
    }
    override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
      val previous = paint.color
      paint.color = chipColor
      val metrics = paint.fontMetrics
      if (!blended) {
        val radius = editor.textSize * 0.25f
        canvas.drawRoundRect(RectF(x + margin, y + metrics.ascent, x + getSize(paint, text, start, end, null) - margin, y + metrics.descent), radius, radius, paint)
      }
      paint.color = if (blended) mutedForeground else editor.currentTextColor
      icon?.let { bitmap ->
        val center = y + (metrics.ascent + metrics.descent) / 2
        val iconTop = if (kind == "paste") y - iconSize + editor.textSize * metric("iconBaselineEm", 0.15f) else center - iconSize / 2
        canvas.drawBitmap(bitmap, null, RectF(x + margin + padding, iconTop, x + margin + padding + iconSize, iconTop + iconSize), paint)
      }
      val layout = pasteLayout(paint)
      if (layout == null) canvas.drawText(label, x + margin + padding + iconWidth, y.toFloat(), paint)
      else {
        canvas.save()
        canvas.translate(x + margin + padding + iconWidth, y + metrics.ascent)
        layout.draw(canvas)
        canvas.restore()
      }
      paint.color = previous
    }
  }
}
