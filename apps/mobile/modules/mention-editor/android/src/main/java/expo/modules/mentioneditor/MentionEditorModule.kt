package expo.modules.mentioneditor

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MentionEditorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SuperOneMentionEditor")
    View(MentionEditorView::class) {
      Events("onDocumentChange", "onContentHeightChange", "onSubmit")
      Prop("submitOnReturn") { view: MentionEditorView, value: Boolean -> view.setSubmitOnReturn(value) }
      Prop("editable") { view: MentionEditorView, value: Boolean -> view.setEditable(value) }
      Prop("placeholder") { view: MentionEditorView, value: String -> view.setPlaceholder(value) }
      Prop("editorLabel") { view: MentionEditorView, value: String -> view.setEditorLabel(value) }
      Prop("command") { view: MentionEditorView, command: Map<String, Any?> -> view.applyCommand(command) }
      Prop("foreground") { view: MentionEditorView, color: String -> view.setForeground(color) }
      Prop("chipBackground") { view: MentionEditorView, color: String -> view.setChipBackground(color) }
      Prop("mutedForeground") { view: MentionEditorView, color: String -> view.setMutedForeground(color) }
      Prop("blendedKinds") { view: MentionEditorView, kinds: List<String> -> view.setBlendedKinds(kinds) }
      Prop("artwork") { view: MentionEditorView, images: List<Map<String, String>> -> view.setArtwork(images) }
    }
  }
}
