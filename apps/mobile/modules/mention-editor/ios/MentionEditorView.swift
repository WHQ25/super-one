import ExpoModulesCore
import UIKit

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
    case "file", "agent": return "@" + value
    case "directory": return "@" + value + (value.hasSuffix("/") ? "" : "/")
    default: return "@" + label
    }
  }

  func render(font: UIFont, foreground: UIColor, background: UIColor, blended: Bool, icon: UIImage?) {
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: foreground]
    let textSize = (label as NSString).size(withAttributes: attributes)
    // Match desktop .mention-chip--resource / --blended em geometry.
    let margin = font.pointSize * (blended ? 0.25 : 0.125)
    let padding = font.pointSize * (blended ? 0 : 0.35)
    let iconWidth = icon == nil ? 0 : font.pointSize * 1.25
    let contentWidth = ceil(textSize.width) + padding * 2 + iconWidth
    let size = CGSize(width: contentWidth + margin * 2, height: ceil(font.lineHeight))
    image = UIGraphicsImageRenderer(size: size).image { _ in
      if !blended {
        background.setFill()
        UIBezierPath(roundedRect: CGRect(x: margin, y: 0, width: contentWidth, height: size.height), cornerRadius: font.pointSize * 0.25).fill()
      }
      icon?.draw(in: CGRect(x: margin + padding, y: (size.height - font.pointSize) / 2, width: font.pointSize, height: font.pointSize))
      (label as NSString).draw(at: CGPoint(x: margin + padding + iconWidth, y: 0), withAttributes: attributes)
    }
    bounds = CGRect(x: 0, y: font.descender, width: size.width, height: size.height)
  }
}

private final class MentionTextView: UITextView {
  private(set) var insertingLiteral = false
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
  override func copy(_ sender: Any?) { UIPasteboard.general.string = copySelection?() ?? "" }
  override func cut(_ sender: Any?) { copy(sender); cutSelection?() }
  override func paste(_ sender: Any?) {
    guard let value = UIPasteboard.general.string else { return }
    insertLiteral(value.replacingOccurrences(of: "\u{FFFC}", with: "\u{FFFD}"))
  }
}

final class MentionEditorView: ExpoView, UITextViewDelegate {
  let onDocumentChange = EventDispatcher()
  let onContentHeightChange = EventDispatcher()
  let onSubmit = EventDispatcher()
  private var submitOnReturn = false
  private var lastContentHeight: CGFloat = 0
  private let editor = MentionTextView()
  private let placeholderLabel = UILabel()
  private var eventCount = 0
  private var lastCommand = -1
  private var changing = false
  private var foreground = UIColor.label
  private var mutedForeground = UIColor.secondaryLabel
  private var blendedKinds = Set<String>()
  private var chipBackground = UIColor.clear
  private var artwork: [String: UIImage] = [:]
  private var editorFont = UIFont.systemFont(ofSize: 15)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    editor.delegate = self
    editor.font = editorFont
    editor.backgroundColor = .clear
    editor.textContainerInset = UIEdgeInsets(top: 10, left: 7, bottom: 10, right: 7)
    editor.autocorrectionType = .yes
    editor.copySelection = { [weak self] in self?.plainSelection() ?? "" }
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
    placeholderLabel.font = editorFont
    placeholderLabel.textColor = mutedForeground
    placeholderLabel.isAccessibilityElement = false
    placeholderLabel.numberOfLines = 0
    placeholderLabel.isUserInteractionEnabled = false
    editor.addSubview(placeholderLabel)
    addSubview(editor)
    updateFontIfNeeded()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
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
    editor.selectedRange = selection
    changing = false
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    editor.frame = bounds
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
    return true
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
    if !changing { updateFontIfNeeded(); publish() }
  }

  func setForeground(_ value: String) {
    guard let color = Self.color(value) else { return }
    foreground = color
    editor.textColor = color
    redrawAttachments()
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
  private func render(_ attachment: MentionAttachment) {
    let blended = blendedKinds.contains(attachment.kind)
    attachment.render(font: editorFont, foreground: blended ? mutedForeground : foreground,
      background: chipBackground, blended: blended, icon: artwork["\(attachment.kind):\(attachment.value)"])
  }
  func setArtwork(_ images: [[String: String]]) {
    var next: [String: UIImage] = [:]
    for row in images {
      guard let key = row["key"], let png = row["png"], let bytes = Data(base64Encoded: png), let image = UIImage(data: bytes) else { continue }
      next[key] = image
    }
    artwork = next
    redrawAttachments()
  }
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
    editor.setNeedsLayout()
    editor.setNeedsDisplay()
  }

  func applyCommand(_ command: [String: Any]) {
    guard let id = command["id"] as? Int, id > lastCommand else { return }
    lastCommand = id
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

  private func publish(rejection: String? = nil) {
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
      "start": selection.location, "end": selection.location + selection.length, "composing": editor.markedTextRange != nil]
    if let rejection { event["rejection"] = rejection }
    onDocumentChange(event)
  }
}
