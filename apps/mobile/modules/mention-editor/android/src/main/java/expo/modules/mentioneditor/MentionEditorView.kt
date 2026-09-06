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
import android.text.Editable
import android.text.Spannable
import android.text.SpannableString
import android.text.TextWatcher
import android.text.style.ReplacementSpan
import android.view.Gravity
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
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
  private var submitOnReturn = false
  private var lastContentHeight = 0
  private var eventCount = 0
  private var lastCommand = -1
  private var changing = false
  private var mutedForeground = Color.GRAY
  private var blendedKinds = emptySet<String>()
  private var chipColor = Color.TRANSPARENT
  private var artwork = emptyMap<String, Bitmap>()
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
          value.replace(start, end, pasted)
          setSelection(start + pasted.length)
          return true
        }
      }
      return super.onTextContextMenuItem(id)
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

  fun setSubmitOnReturn(value: Boolean) {
    if (submitOnReturn == value) return
    submitOnReturn = value
    editor.imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI or (if (value) EditorInfo.IME_ACTION_SEND else EditorInfo.IME_FLAG_NO_ENTER_ACTION)
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

  fun applyCommand(command: Map<String, Any?>) {
    val id = (command["id"] as? Number)?.toInt() ?: return
    if (id <= lastCommand) return
    lastCommand = id
    val expected = (command["eventCount"] as? Number)?.toInt() ?: return
    val value = editor.text ?: return
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

  private fun publishContentHeight() {
    val layout = editor.layout ?: return
    val pixels = layout.height + editor.compoundPaddingTop + editor.compoundPaddingBottom
    if (pixels <= 0 || pixels == lastContentHeight) return
    lastContentHeight = pixels
    onContentHeightChange(mapOf("height" to pixels / resources.displayMetrics.density))
  }

  private fun publish(rejection: String? = null) {
    editor.post { publishContentHeight() }
    val value = editor.text ?: return
    val tokens = value.getSpans(0, value.length, ChipSpan::class.java).mapNotNull { span ->
      val offset = value.getSpanStart(span)
      if (offset < 0 || offset >= value.length || value[offset] != '\uFFFC') null
      else mapOf("kind" to span.kind, "value" to span.value, "displayName" to span.label, "offset" to offset)
    }
    onDocumentChange(mapOf("text" to value.toString(), "tokens" to tokens,
      "eventCount" to eventCount, "start" to editor.selectionStart, "end" to editor.selectionEnd,
      "composing" to (BaseInputConnection.getComposingSpanStart(value) >= 0), "rejection" to rejection))
  }

  private inner class ChipSpan(val kind: String, val value: String, val label: String) : ReplacementSpan() {
    private val blended get() = kind in blendedKinds
    private val margin get() = editor.textSize * if (blended) 0.25f else 0.125f
    private val padding get() = if (blended) 0f else editor.textSize * 0.35f
    private val icon get() = artwork["$kind:$value"]
    private val iconWidth get() = if (icon != null) editor.textSize * 1.25f else 0f
    override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
      if (fm != null) {
        val metrics = paint.fontMetricsInt
        fm.ascent = metrics.ascent; fm.descent = metrics.descent
        fm.top = metrics.top; fm.bottom = metrics.bottom; fm.leading = metrics.leading
      }
      return kotlin.math.ceil(paint.measureText(label) + (padding + margin) * 2 + iconWidth).toInt()
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
        val size = editor.textSize
        canvas.drawBitmap(bitmap, null, RectF(x + margin + padding, center - size / 2, x + margin + padding + size, center + size / 2), paint)
      }
      canvas.drawText(label, x + margin + padding + iconWidth, y.toFloat(), paint)
      paint.color = previous
    }
  }
}
