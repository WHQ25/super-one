import CoreText
import ExpoModulesCore
import UIKit

/// A prompt keyword letter's place in its word and its two colours. It rides on
/// the character as an attribute, so the shimmer follows the letter through
/// edits until JS sends the next draft's keywords.
private final class KeywordLetter {
  let index: Int
  let color: UIColor
  let shimmer: UIColor
  init(index: Int, color: UIColor, shimmer: UIColor) {
    self.index = index
    self.color = color
    self.shimmer = shimmer
  }
}

private extension NSAttributedString.Key {
  static let promptKeyword = NSAttributedString.Key("SuperOnePromptKeyword")
  /// A bare URL's whole range: link colour (`setLinks`).
  static let webLink = NSAttributedString.Key("SuperOneWebLink")
  /// The URL's first character, carrying the artwork key of the icon drawn before it.
  static let webLinkIcon = NSAttributedString.Key("SuperOneWebLinkIcon")
}

/// Draws a bare URL's favicon in front of it without giving the icon a character:
/// the draft's text and offsets stay exactly JS's. The URL's first letter (always
/// the `h` of `http`) is laid out as a whitespace control glyph as wide as icon,
/// gap and letter, and this draws the icon and then the letter into that space.
/// Caret, selection and hit-testing still see one character there.
private final class WebLinkLayoutManager: NSLayoutManager, NSLayoutManagerDelegate {
  static let globe = "web-link"
  var icons: [String: UIImage] = [:]
  var iconSizeEm: CGFloat = 0.9
  var iconGapEm: CGFloat = 0.25
  var iconBaselineEm: CGFloat = 0.1
  var underline = true

  override init() {
    super.init()
    delegate = self
  }
  required init?(coder: NSCoder) { return nil }

  /// The marked first letter at `index`, styled as the text view would draw it.
  private func letter(at index: Int) -> (font: UIFont, text: NSAttributedString)? {
    guard let storage = textStorage, index < storage.length,
      storage.attribute(.webLinkIcon, at: index, effectiveRange: nil) != nil else { return nil }
    let font = storage.attribute(.font, at: index, effectiveRange: nil) as? UIFont ?? .systemFont(ofSize: 15)
    var attributes: [NSAttributedString.Key: Any] = [.font: font,
      .foregroundColor: storage.attribute(.foregroundColor, at: index, effectiveRange: nil) ?? UIColor.label]
    if underline { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
    return (font, NSAttributedString(string: (storage.string as NSString).substring(with: NSRange(location: index, length: 1)), attributes: attributes))
  }

  private func reserved(_ font: UIFont) -> CGFloat { font.pointSize * (iconSizeEm + iconGapEm) }

  func layoutManager(_ layoutManager: NSLayoutManager, shouldGenerateGlyphs glyphs: UnsafePointer<CGGlyph>,
    properties: UnsafePointer<NSLayoutManager.GlyphProperty>, characterIndexes: UnsafePointer<Int>, font: UIFont,
    forGlyphRange glyphRange: NSRange) -> Int {
    guard let storage = textStorage else { return 0 }
    var marked: [NSLayoutManager.GlyphProperty]?
    for index in 0..<glyphRange.length where characterIndexes[index] < storage.length
      && storage.attribute(.webLinkIcon, at: characterIndexes[index], effectiveRange: nil) != nil {
      if marked == nil { marked = Array(UnsafeBufferPointer(start: properties, count: glyphRange.length)) }
      marked?[index] = .controlCharacter
    }
    guard let marked else { return 0 }
    setGlyphs(glyphs, properties: marked, characterIndexes: characterIndexes, font: font, forGlyphRange: glyphRange)
    return glyphRange.length
  }

  func layoutManager(_ layoutManager: NSLayoutManager, shouldUse action: NSLayoutManager.ControlCharacterAction,
    forControlCharacterAt charIndex: Int) -> NSLayoutManager.ControlCharacterAction {
    guard let storage = textStorage, charIndex < storage.length,
      storage.attribute(.webLinkIcon, at: charIndex, effectiveRange: nil) != nil else { return action }
    return .whitespace
  }

  func layoutManager(_ layoutManager: NSLayoutManager, boundingBoxForControlGlyphAt glyphIndex: Int, for textContainer: NSTextContainer,
    proposedLineFragment proposedRect: CGRect, glyphPosition: CGPoint, characterIndex charIndex: Int) -> CGRect {
    guard let letter = letter(at: charIndex) else { return CGRect(origin: glyphPosition, size: .zero) }
    return CGRect(x: glyphPosition.x, y: glyphPosition.y - letter.font.ascender,
      width: reserved(letter.font) + ceil(letter.text.size().width), height: letter.font.lineHeight)
  }

  override func drawGlyphs(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
    super.drawGlyphs(forGlyphRange: glyphsToShow, at: origin)
    guard let storage = textStorage else { return }
    let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
    storage.enumerateAttribute(.webLinkIcon, in: characters) { value, range, _ in
      guard let key = value as? String else { return }
      for index in range.location..<NSMaxRange(range) {
        guard let letter = letter(at: index) else { continue }
        let glyph = glyphIndexForCharacter(at: index)
        guard NSLocationInRange(glyph, glyphsToShow) else { continue }
        let line = lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        let position = location(forGlyphAt: glyph)
        let x = origin.x + line.minX + position.x
        let baseline = origin.y + line.minY + position.y
        let em = letter.font.pointSize
        let size = em * iconSizeEm
        // CSS `vertical-align: -0.1em`: the icon's bottom sits that far below the baseline.
        (icons[key] ?? icons[Self.globe])?.draw(in: CGRect(x: x, y: baseline + em * iconBaselineEm - size, width: size, height: size))
        letter.text.draw(at: CGPoint(x: x + reserved(letter.font), y: baseline - letter.font.ascender))
      }
    }
  }
}

/// Breaks the display link's retain on the view.
private final class WeakTicker {
  weak var target: MentionEditorView?
  init(_ target: MentionEditorView) { self.target = target }
  @objc func tick() { target?.shimmerTick() }
}

/// The desktop chip's one-line, 40-code-point label; its value keeps the full paste.
private enum PasteChip {
  static func summary(_ text: String) -> String {
    let collapsed = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let chars = Array(collapsed.unicodeScalars.prefix(41))
    return String(String.UnicodeScalarView(chars.prefix(40))) + (chars.count > 40 ? "…" : "")
  }

  /// Mirrors `isComposerPasteChip`: more than three lines, ignoring line breaks at
  /// the ends, or at least 500 UTF-16 units — but never a lone link, however long.
  static func accepts(_ text: String) -> Bool {
    let body = text.trimmingCharacters(in: .newlines)
    return !body.trimmingCharacters(in: .whitespaces).isEmpty && !isSingleWebLink(text)
      && (text.utf16.count >= 500 || body.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).count > 3)
  }

  /// `isSingleWebLink` in `@superone/shared/web-links`, without its closing-parenthesis rule:
  /// the trimmed text is one http(s) URL with a host, not ending in punctuation.
  static let singleWebLink = "^https?://[^/?#\\s<>\"'`\\u3000-\\u303F\\uFF00-\\uFFEF]+[^\\s<>\"'`\\u3000-\\u303F\\uFF00-\\uFFEF]*(?<![?!.,:;*_~])$"
  static func isSingleWebLink(_ text: String) -> Bool {
    text.trimmingCharacters(in: .whitespacesAndNewlines).range(of: singleWebLink, options: [.regularExpression, .caseInsensitive]) != nil
  }
}

private final class MentionAttachment: NSTextAttachment {
  let kind: String
  let value: String
  let label: String

  init(kind: String, value: String, label: String) {
    self.kind = kind
    self.value = value
    self.label = label
    super.init(data: nil, ofType: nil)
  }
  required init?(coder: NSCoder) { return nil }

  var plainText: String {
    switch kind {
    case "paste": return "\n" + value + "\n"
    case "file", "agent": return "@" + value
    case "directory": return "@" + value + (value.hasSuffix("/") ? "" : "/")
    default: return "@" + label
    }
  }

  func render(font: UIFont, foreground: UIColor, background: UIColor, blended: Bool, icon: UIImage?, maxWidth: CGFloat? = nil, chrome: [String: Double]? = nil) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = maxWidth == nil ? .byTruncatingTail : .byWordWrapping
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: foreground, .paragraphStyle: paragraph]
    let textSize = (label as NSString).size(withAttributes: attributes)
    // Match desktop .mention-chip--resource / --blended em geometry.
    let margin = font.pointSize * CGFloat(chrome?["marginEm"] ?? (blended ? 0.25 : 0.125))
    let padding = font.pointSize * CGFloat(chrome?["paddingEm"] ?? (blended ? 0 : 0.35))
    let iconSize = font.pointSize * CGFloat(chrome?["iconSizeEm"] ?? 1)
    let iconWidth = icon == nil ? 0 : iconSize + font.pointSize * CGFloat(chrome?["iconGapEm"] ?? 0.25)
    let labelWidth = min(ceil(textSize.width), maxWidth.map { max(1, $0 - (padding + margin) * 2 - iconWidth) } ?? ceil(textSize.width))
    let contentWidth = labelWidth + padding * 2 + iconWidth
    let labelHeight = (label as NSString).boundingRect(with: CGSize(width: labelWidth, height: .greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil).height
    let size = CGSize(width: contentWidth + margin * 2, height: ceil(max(font.lineHeight, labelHeight)))
    image = UIGraphicsImageRenderer(size: size).image { _ in
      if !blended {
        background.setFill()
        UIBezierPath(roundedRect: CGRect(x: margin, y: 0, width: contentWidth, height: size.height), cornerRadius: font.pointSize * 0.25).fill()
      }
      let iconY = chrome.map { font.ascender - iconSize + font.pointSize * CGFloat($0["iconBaselineEm"] ?? 0.15) } ?? (ceil(font.lineHeight) - iconSize) / 2
      icon?.draw(in: CGRect(x: margin + padding, y: iconY, width: iconSize, height: iconSize))
      (label as NSString).draw(in: CGRect(x: margin + padding + iconWidth, y: 0, width: labelWidth, height: size.height), withAttributes: attributes)
    }
    // Keep the first label line on the prose baseline when a narrow chip wraps.
    bounds = CGRect(x: 0, y: font.descender - (size.height - ceil(font.lineHeight)), width: size.width, height: size.height)
  }
}

private final class MentionTextView: UITextView {
  private(set) var insertingLiteral = false
  /// Whether a point (in this view) lands on a chip, and the recognizer that answers it.
  var hitsChip: ((CGPoint) -> Bool)?
  weak var chipTap: UIGestureRecognizer?
  // A tap on a chip opens its preview; placing the caret or raising the keyboard as well
  // would move the composer under the preview, which closes it.
  override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
    let onChip = hitsChip?(recognizer.location(in: self)) == true
    if recognizer === chipTap { return onChip }
    if recognizer is UITapGestureRecognizer, onChip { return false }
    return super.gestureRecognizerShouldBegin(recognizer)
  }
  override var keyCommands: [UIKeyCommand]? {
    (super.keyCommands ?? []) + [UIKeyCommand(input: "\r", modifierFlags: .shift, action: #selector(insertLineBreak))]
  }
  @objc private func insertLineBreak() { insertLiteral("\n") }
  private func insertLiteral(_ value: String) {
    insertingLiteral = true
    defer { insertingLiteral = false }
    insertText(value)
  }
  var copySelection: (() -> String)?
  var cutSelection: (() -> Void)?
  var pasteText: ((String) -> Void)?
  override func copy(_ sender: Any?) { UIPasteboard.general.string = copySelection?() ?? "" }
  override func cut(_ sender: Any?) { copy(sender); cutSelection?() }
  override func paste(_ sender: Any?) {
    guard let value = UIPasteboard.general.string else { return }
    let text = value.replacingOccurrences(of: "\u{FFFC}", with: "\u{FFFD}")
    if PasteChip.accepts(text) { pasteText?(text) } else { insertLiteral(text) }
  }
}

final class MentionEditorView: ExpoView, UITextViewDelegate {
  let onDocumentChange = EventDispatcher()
  let onContentHeightChange = EventDispatcher()
  let onSubmit = EventDispatcher()
  let onMentionPress = EventDispatcher()
  private var submitOnReturn = false
  private var lastContentHeight: CGFloat = 0
  private var lastEditorWidth: CGFloat = 0
  /// TextKit 1, built by hand so link icons can be drawn (`WebLinkLayoutManager`).
  /// The text view does not retain its storage; this does.
  private let textStorage: NSTextStorage
  private let linkLayout: WebLinkLayoutManager
  private let editor: MentionTextView
  private let placeholderLabel = UILabel()
  private var eventCount = 0
  private var lastCommand = -1
  private var changing = false
  private var foreground = UIColor.label
  private var mutedForeground = UIColor.secondaryLabel
  private var blendedKinds = Set<String>()
  private var pasteChrome: [String: Double] = [:]
  private var chipBackground = UIColor.clear
  private var artwork: [String: UIImage] = [:]
  private var editorFont = UIFont.systemFont(ofSize: 15)
  private var keywordAnimate = false
  private var keywordStepMs = 50
  private var keywordSteps = 30
  private var keywordBand = 3
  private var keywordStep = -1
  private var keywordLink: CADisplayLink?
  private var linkColor = UIColor.systemBlue
  /// The last `links` prop, held while the draft it was computed for is still being composed.
  private var pendingLinks: [String: Any]?

  /// The draft's keywords render in pixel capitals (`fonts/`, see scripts/build-font.py),
  /// registered once from this module's resource bundle.
  private static let keywordFontName: String? = {
    guard let bundle = Bundle(for: MentionEditorView.self).url(forResource: "SuperOneMentionEditorFonts", withExtension: "bundle").flatMap(Bundle.init(url:)),
      let url = bundle.url(forResource: "superone-keyword-pixel", withExtension: "ttf") else { return nil }
    CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    return "SuperOneKeywordPixel-Regular"
  }()
  /// A font pixel is 1/8 em, so 16/15 of the 15pt body makes it exactly 2pt, as on desktop.
  private var keywordFont: UIFont {
    Self.keywordFontName.flatMap { UIFont(name: $0, size: editorFont.pointSize * 16 / 15) } ?? editorFont
  }

  required init(appContext: AppContext? = nil) {
    let storage = NSTextStorage()
    let layout = WebLinkLayoutManager()
    storage.addLayoutManager(layout)
    let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
    container.widthTracksTextView = true
    layout.addTextContainer(container)
    textStorage = storage
    linkLayout = layout
    editor = MentionTextView(frame: .zero, textContainer: container)
    super.init(appContext: appContext)
    linkLayout.delegate = linkLayout
    editor.delegate = self
    editor.font = editorFont
    editor.backgroundColor = .clear
    editor.textContainerInset = UIEdgeInsets(top: 10, left: 7, bottom: 10, right: 7)
    editor.autocorrectionType = .yes
    editor.copySelection = { [weak self] in self?.plainSelection() ?? "" }
    editor.pasteText = { [weak self] in self?.insertPaste($0) }
    editor.cutSelection = { [weak self] in
      guard let self else { return }
      self.editor.unmarkText()
      let range = self.editor.selectedRange
      self.changing = true
      self.editor.textStorage.replaceCharacters(in: range, with: "")
      self.editor.selectedRange = NSRange(location: range.location, length: 0)
      self.changing = false
      self.eventCount += 1
      self.publish()
    }
    let chipTap = UITapGestureRecognizer(target: self, action: #selector(pressChip(_:)))
    editor.addGestureRecognizer(chipTap)
    editor.chipTap = chipTap
    editor.hitsChip = { [weak self] point in self?.chip(at: point) != nil }
    placeholderLabel.font = editorFont
    placeholderLabel.textColor = mutedForeground
    placeholderLabel.isAccessibilityElement = false
    placeholderLabel.numberOfLines = 0
    placeholderLabel.isUserInteractionEnabled = false
    editor.addSubview(placeholderLabel)
    addSubview(editor)
    updateFontIfNeeded()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
      updateFontIfNeeded()
    }
  }

  private func updateFontIfNeeded() {
    // Defer style changes until marked text commits; never replace an IME draft.
    guard !changing, editor.markedTextRange == nil else { return }
    let next = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont.systemFont(ofSize: 15), compatibleWith: traitCollection)
    guard abs(next.pointSize - editorFont.pointSize) > 0.01 else { return }
    changing = true
    let selection = editor.selectedRange
    editorFont = next
    editor.font = next
    editor.textStorage.addAttribute(.font, value: next, range: NSRange(location: 0, length: editor.textStorage.length))
    editor.typingAttributes[.font] = next
    placeholderLabel.font = next
    redrawAttachments()
    restyleKeywords()
    editor.selectedRange = selection
    changing = false
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    editor.frame = bounds
    if lastEditorWidth != editor.bounds.width {
      lastEditorWidth = editor.bounds.width
      redrawAttachments()
    }
    let inset = editor.textContainerInset
    let x = inset.left + editor.textContainer.lineFragmentPadding
    let width = max(0, bounds.width - x - inset.right - editor.textContainer.lineFragmentPadding)
    placeholderLabel.frame = CGRect(x: x, y: inset.top, width: width,
      height: placeholderLabel.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
    publishContentHeight()
  }
  private func publishContentHeight() {
    guard editor.bounds.width > 0 else { return }
    let height = ceil(editor.sizeThatFits(CGSize(width: editor.bounds.width, height: .greatestFiniteMagnitude)).height)
    guard height > 0, height != lastContentHeight else { return }
    lastContentHeight = height
    onContentHeightChange(["height": height])
  }
  func setSubmitOnReturn(_ value: Bool) {
    submitOnReturn = value
    editor.returnKeyType = value ? .send : .default
    if editor.isFirstResponder { editor.reloadInputViews() }
  }
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    if text == "\n", submitOnReturn, !editor.insertingLiteral, editor.markedTextRange == nil {
      onSubmit(["eventCount": eventCount])
      return false
    }
    plainTypingAttributes()
    return true
  }
  /// UIKit copies the attributes before the caret into what is typed next; a
  /// letter typed against a keyword is plain until JS says it is one.
  private func plainTypingAttributes() {
    editor.typingAttributes = [.font: editorFont, .foregroundColor: foreground]
  }
  /// The chip drawn under `point` (editor coordinates), with its offset and frame in the editor.
  private func chip(at point: CGPoint) -> (offset: Int, attachment: MentionAttachment, frame: CGRect)? {
    let storage = editor.textStorage
    guard storage.length > 0 else { return nil }
    let inset = editor.textContainerInset
    let location = CGPoint(x: point.x - inset.left, y: point.y - inset.top)
    let glyph = editor.layoutManager.glyphIndex(for: location, in: editor.textContainer)
    let offset = editor.layoutManager.characterIndexForGlyph(at: glyph)
    guard offset < storage.length, let attachment = storage.attribute(.attachment, at: offset, effectiveRange: nil) as? MentionAttachment else { return nil }
    let frame = editor.layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: editor.textContainer)
    guard frame.contains(location) else { return nil }
    return (offset, attachment, frame.offsetBy(dx: inset.left, dy: inset.top))
  }
  @objc private func pressChip(_ recognizer: UITapGestureRecognizer) {
    guard let hit = chip(at: recognizer.location(in: editor)) else { return }
    let frame = editor.convert(hit.frame, to: self)
    onMentionPress(["offset": hit.offset, "kind": hit.attachment.kind, "value": hit.attachment.value, "displayName": hit.attachment.label,
      "x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height])
  }
  func setEditable(_ value: Bool) {
    editor.isEditable = value
    if !value { editor.resignFirstResponder() }
  }
  func setPlaceholder(_ value: String) { placeholderLabel.text = value; setNeedsLayout() }
  func setEditorLabel(_ value: String) { editor.accessibilityLabel = value }

  func textViewDidChange(_ textView: UITextView) {
    guard !changing else { return }
    updateFontIfNeeded()
    eventCount += 1
    publish()
  }
  func textViewDidChangeSelection(_ textView: UITextView) {
    plainTypingAttributes()
    if !changing { updateFontIfNeeded(); publish() }
  }

  func setForeground(_ value: String) {
    guard let color = Self.color(value) else { return }
    foreground = color
    editor.textColor = color
    redrawAttachments()
    editKeywordAttributes { paintBaseColors(in: NSRange(location: 0, length: editor.textStorage.length)) }
    restyleKeywords()
  }
  func setChipBackground(_ value: String) {
    guard let color = Self.color(value) else { return }
    chipBackground = color
    redrawAttachments()
  }
  func setMutedForeground(_ value: String) {
    guard let color = Self.color(value) else { return }
    mutedForeground = color
    placeholderLabel.textColor = color
    redrawAttachments()
  }
  func setBlendedKinds(_ kinds: [String]) {
    blendedKinds = Set(kinds)
    redrawAttachments()
  }
  func setPasteChrome(_ value: [String: Double]) { pasteChrome = value; redrawAttachments() }
  private func render(_ attachment: MentionAttachment) {
    let blended = blendedKinds.contains(attachment.kind)
    let paste = attachment.kind == "paste"
    let icon = artwork[paste ? "paste" : "\(attachment.kind):\(attachment.value)"]
    let availableWidth = max(24, editor.bounds.width - editor.textContainerInset.left - editor.textContainerInset.right - editor.textContainer.lineFragmentPadding * 2)
    attachment.render(font: editorFont, foreground: blended ? mutedForeground : foreground,
      background: chipBackground, blended: blended, icon: icon, maxWidth: paste ? availableWidth : nil, chrome: paste ? pasteChrome : nil)
  }
  private func insertPaste(_ text: String) {
    guard editor.isEditable else { return }
    editor.unmarkText()
    let attachment = MentionAttachment(kind: "paste", value: text, label: PasteChip.summary(text))
    render(attachment)
    let replacement = NSAttributedString(string: "\u{FFFC}", attributes: [.attachment: attachment, .font: editorFont, .foregroundColor: foreground])
    replacePasteRange(editor.selectedRange, with: replacement)
  }
  /// One undoable native edit, including the chip's identity and the replaced selection.
  private func replacePasteRange(_ range: NSRange, with replacement: NSAttributedString, selection: NSRange? = nil) {
    guard range.location >= 0, NSMaxRange(range) <= editor.textStorage.length else { return }
    let previous = editor.textStorage.attributedSubstring(from: range)
    let previousSelection = editor.selectedRange
    editor.undoManager?.registerUndo(withTarget: self) { target in
      target.replacePasteRange(NSRange(location: range.location, length: replacement.length), with: previous, selection: previousSelection)
    }
    changing = true
    editor.textStorage.replaceCharacters(in: range, with: replacement)
    editor.selectedRange = selection ?? NSRange(location: range.location + replacement.length, length: 0)
    plainTypingAttributes()
    changing = false
    eventCount += 1
    publish()
  }
  func setArtwork(_ images: [[String: String]]) {
    var next: [String: UIImage] = [:]
    for row in images {
      guard let key = row["key"], let png = row["png"], let bytes = Data(base64Encoded: png), let image = UIImage(data: bytes) else { continue }
      next[key] = image
    }
    artwork = next
    linkLayout.icons = next
    redrawAttachments()
  }
  /// Paints the draft's prompt keywords: JS's `KeywordHighlight`, for the draft
  /// with this `eventCount` only. A later keystroke gets its own highlight next.
  func setKeywords(_ value: [String: Any]) {
    guard let expected = value["eventCount"] as? Int, expected == eventCount, editor.markedTextRange == nil else { return }
    keywordAnimate = value["animate"] as? Bool ?? false
    keywordStepMs = max(1, value["stepMs"] as? Int ?? keywordStepMs)
    keywordSteps = max(1, value["steps"] as? Int ?? keywordSteps)
    keywordBand = value["band"] as? Int ?? keywordBand
    let storage = editor.textStorage
    let letters = (value["letters"] as? [[String: Any]] ?? []).compactMap { row -> (Int, KeywordLetter)? in
      guard let offset = row["offset"] as? Int, offset >= 0, offset < storage.length,
        storage.attribute(.attachment, at: offset, effectiveRange: nil) == nil,
        let index = row["index"] as? Int, let color = (row["color"] as? String).flatMap(Self.color),
        let shimmer = (row["shimmer"] as? String).flatMap(Self.color) else { return nil }
      return (offset, KeywordLetter(index: index, color: color, shimmer: shimmer))
    }
    editKeywordAttributes {
      storage.enumerateAttribute(.promptKeyword, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
        guard value != nil else { return }
        storage.removeAttribute(.promptKeyword, range: range)
        storage.addAttribute(.font, value: self.editorFont, range: range)
        self.paintBaseColors(in: range)
      }
      for (offset, letter) in letters {
        storage.addAttribute(.promptKeyword, value: letter, range: NSRange(location: offset, length: 1))
      }
    }
    restyleKeywords()
  }

  /// Paints the draft's bare URLs: JS's `LinkHighlight`, for the draft with this
  /// `eventCount` only. One that arrives while the draft is composed waits for
  /// the composition to end. A keyword letter inside a URL keeps its keyword style.
  func setLinks(_ value: [String: Any]) {
    pendingLinks = value
    applyPendingLinks()
  }

  private func applyPendingLinks() {
    guard let value = pendingLinks else { return }
    guard let expected = value["eventCount"] as? Int, expected == eventCount else { pendingLinks = nil; return }
    guard editor.markedTextRange == nil else { return }
    pendingLinks = nil
    if let color = (value["color"] as? String).flatMap(Self.color) {
      linkColor = color.withAlphaComponent(CGFloat(value["alpha"] as? Double ?? 1))
    }
    let metric = { (name: String, fallback: CGFloat) in (value[name] as? Double).map { CGFloat($0) } ?? fallback }
    linkLayout.iconSizeEm = metric("iconSizeEm", linkLayout.iconSizeEm)
    linkLayout.iconGapEm = metric("iconGapEm", linkLayout.iconGapEm)
    linkLayout.iconBaselineEm = metric("iconBaselineEm", linkLayout.iconBaselineEm)
    linkLayout.underline = value["underline"] as? Bool ?? linkLayout.underline
    let storage = editor.textStorage
    let text = storage.string as NSString
    let links = (value["links"] as? [[String: Any]] ?? []).compactMap { row -> (NSRange, String)? in
      guard let start = row["start"] as? Int, let end = row["end"] as? Int, start >= 0, end > start, end <= storage.length,
        let icon = row["icon"] as? String else { return nil }
      let range = NSRange(location: start, length: end - start)
      return text.range(of: "\u{FFFC}", options: [], range: range).location == NSNotFound ? (range, icon) : nil
    }
    editKeywordAttributes {
      let all = NSRange(location: 0, length: storage.length)
      for key in [NSAttributedString.Key.webLink, .webLinkIcon, .underlineStyle] { storage.removeAttribute(key, range: all) }
      for (range, icon) in links {
        storage.addAttribute(.webLink, value: true, range: range)
        storage.addAttribute(.webLinkIcon, value: icon, range: NSRange(location: range.location, length: 1))
        // The first letter's underline is drawn with it; the icon's space stays bare, as on desktop.
        if linkLayout.underline, range.length > 1 {
          storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: NSRange(location: range.location + 1, length: range.length - 1))
        }
      }
      paintBaseColors(in: all)
    }
    restyleKeywords()
  }

  /// Link colour inside a URL, the text colour elsewhere; keyword letters keep their own.
  private func paintBaseColors(in range: NSRange) {
    let storage = editor.textStorage
    storage.enumerateAttributes(in: range) { attributes, run, _ in
      guard attributes[.promptKeyword] == nil, attributes[.attachment] == nil else { return }
      storage.addAttribute(.foregroundColor, value: attributes[.webLink] != nil ? linkColor : foreground, range: run)
    }
  }

  private func editKeywordAttributes(_ body: () -> Void) {
    let selection = editor.selectedRange
    let wasChanging = changing
    changing = true
    editor.undoManager?.disableUndoRegistration()
    editor.textStorage.beginEditing()
    body()
    editor.textStorage.endEditing()
    editor.undoManager?.enableUndoRegistration()
    if editor.selectedRange != selection { editor.selectedRange = selection }
    changing = wasChanging
  }

  /// Font and colour of every keyword letter for the shimmer's current step.
  private func restyleKeywords() {
    guard editor.markedTextRange == nil else { return }
    let step = keywordAnimate ? Int(CACurrentMediaTime() * 1000) / keywordStepMs : -1
    keywordStep = step
    let storage = editor.textStorage
    let font = keywordFont
    var any = false
    editKeywordAttributes {
      storage.enumerateAttribute(.promptKeyword, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
        guard let letter = value as? KeywordLetter else { return }
        any = true
        storage.addAttributes([.font: font, .foregroundColor: self.keywordColor(letter, step: step)], range: range)
      }
    }
    runShimmer(any && keywordAnimate && window != nil)
  }

  private func keywordColor(_ letter: KeywordLetter, step: Int) -> UIColor {
    guard step >= 0 else { return letter.color }
    let phase = ((step - letter.index) % keywordSteps + keywordSteps) % keywordSteps
    return phase < keywordBand ? letter.shimmer : letter.color
  }

  private func runShimmer(_ running: Bool) {
    if running, keywordLink == nil {
      let link = CADisplayLink(target: WeakTicker(self), selector: #selector(WeakTicker.tick))
      link.preferredFramesPerSecond = max(1, 1000 / keywordStepMs)
      link.add(to: .main, forMode: .common)
      keywordLink = link
    } else if !running {
      keywordLink?.invalidate()
      keywordLink = nil
    }
  }

  /// Recolours only the letters the band has entered or left: a colour, never a
  /// font, so the text is not laid out again. A draft being composed is left alone.
  fileprivate func shimmerTick() {
    let step = Int(CACurrentMediaTime() * 1000) / keywordStepMs
    guard editor.markedTextRange == nil, step != keywordStep else { return }
    let previous = keywordStep
    keywordStep = step
    let storage = editor.textStorage
    editKeywordAttributes {
      storage.enumerateAttribute(.promptKeyword, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
        guard let letter = value as? KeywordLetter else { return }
        let color = self.keywordColor(letter, step: step)
        if color !== self.keywordColor(letter, step: previous) { storage.addAttribute(.foregroundColor, value: color, range: range) }
      }
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateFontIfNeeded()
    restyleKeywords()
  }

  deinit { keywordLink?.invalidate() }

  private static func color(_ raw: String) -> UIColor? {
    let hex = raw.hasPrefix("#") ? String(raw.dropFirst()) : raw
    guard hex.count == 6, let value = UInt64(hex, radix: 16) else { return nil }
    return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
  }

  private func redrawAttachments() {
    let storage = editor.textStorage
    storage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: storage.length)) { value, _, _ in
      if let attachment = value as? MentionAttachment {
        self.render(attachment)
      }
    }
    editor.layoutManager.invalidateLayout(forCharacterRange: NSRange(location: 0, length: storage.length), actualCharacterRange: nil)
    editor.layoutManager.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: storage.length))
    editor.setNeedsLayout()
    editor.setNeedsDisplay()
  }

  func applyCommand(_ command: [String: Any]) {
    guard let id = command["id"] as? Int, id > lastCommand else { return }
    lastCommand = id
    // An explicit Send tap commits the IME and reads native text; it must not
    // replace the draft using a potentially stale JS event count.
    if command["action"] as? String == "prepareSubmit" {
      editor.unmarkText()
      publish(submissionId: id)
      return
    }
    guard let expected = command["eventCount"] as? Int else { return }
    guard expected == eventCount, editor.markedTextRange == nil else { publish(rejection: "stale-or-composing"); return }
    guard let start = command["start"] as? Int, let end = command["end"] as? Int,
      start >= 0, end >= start, end <= editor.textStorage.length else { return }
    let text = command["text"] as? String ?? ""
    let replacement = NSMutableAttributedString(string: text, attributes: [.font: editorFont, .foregroundColor: foreground])
    for token in command["tokens"] as? [[String: Any]] ?? [] {
      guard let offset = token["offset"] as? Int, offset >= 0, offset < replacement.length,
        (text as NSString).character(at: offset) == 0xFFFC,
        let kind = token["kind"] as? String, let value = token["value"] as? String else { continue }
      let attachment = MentionAttachment(kind: kind, value: value, label: token["displayName"] as? String ?? value)
      render(attachment)
      replacement.addAttribute(.attachment, value: attachment, range: NSRange(location: offset, length: 1))
    }
    changing = true
    editor.textStorage.replaceCharacters(in: NSRange(location: start, length: end - start), with: replacement)
    editor.selectedRange = NSRange(location: start + replacement.length, length: 0)
    editor.typingAttributes = [.font: editorFont, .foregroundColor: foreground]
    changing = false
    eventCount += 1
    publish()
  }

  private func plainSelection() -> String {
    let selected = NSMutableAttributedString(attributedString: editor.textStorage.attributedSubstring(from: editor.selectedRange))
    selected.enumerateAttribute(.attachment, in: NSRange(location: 0, length: selected.length), options: .reverse) { value, range, _ in
      if let attachment = value as? MentionAttachment { selected.replaceCharacters(in: range, with: attachment.plainText) }
    }
    return selected.string
  }

  private func publish(rejection: String? = nil, submissionId: Int? = nil) {
    placeholderLabel.isHidden = editor.textStorage.length > 0
    setNeedsLayout()
    var tokens: [[String: Any]] = []
    editor.textStorage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: editor.textStorage.length)) { value, range, _ in
      if let attachment = value as? MentionAttachment {
        tokens.append(["offset": range.location, "kind": attachment.kind, "value": attachment.value, "displayName": attachment.label])
      }
    }
    let selection = editor.selectedRange
    var event: [String: Any] = ["text": editor.textStorage.string, "tokens": tokens, "eventCount": eventCount,
      "start": selection.location, "end": selection.location + selection.length, "composing": editor.markedTextRange != nil, "supportsPrepareSubmit": true]
    if let rejection { event["rejection"] = rejection }
    if let submissionId { event["submissionId"] = submissionId }
    onDocumentChange(event)
    applyPendingLinks()
  }
}
