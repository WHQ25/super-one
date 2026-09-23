package expo.modules.windowstatusbar

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WindowStatusBarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SuperOneWindowStatusBar")
    View(WindowStatusBarView::class) {
      Prop("hidden") { view: WindowStatusBarView, hidden: Boolean -> view.setHidden(hidden) }
    }
  }
}
