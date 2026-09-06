import ExpoModulesCore

public class MentionEditorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SuperOneMentionEditor")
    View(MentionEditorView.self) {
      Events("onDocumentChange", "onContentHeightChange", "onSubmit")
      Prop("submitOnReturn") { (view: MentionEditorView, value: Bool) in view.setSubmitOnReturn(value) }
      Prop("editable") { (view: MentionEditorView, value: Bool) in view.setEditable(value) }
      Prop("placeholder") { (view: MentionEditorView, value: String) in view.setPlaceholder(value) }
      Prop("editorLabel") { (view: MentionEditorView, value: String) in view.setEditorLabel(value) }
      Prop("command") { (view: MentionEditorView, command: [String: Any]) in view.applyCommand(command) }
      Prop("foreground") { (view: MentionEditorView, color: String) in view.setForeground(color) }
      Prop("chipBackground") { (view: MentionEditorView, color: String) in view.setChipBackground(color) }
      Prop("mutedForeground") { (view: MentionEditorView, color: String) in view.setMutedForeground(color) }
      Prop("blendedKinds") { (view: MentionEditorView, kinds: [String]) in view.setBlendedKinds(kinds) }
      Prop("artwork") { (view: MentionEditorView, images: [[String: String]]) in view.setArtwork(images) }
    }
  }
}
