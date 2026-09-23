package expo.modules.windowstatusbar

import android.content.Context
import android.os.Build
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Shows or hides the status bar of the window this view is attached to.
 *
 * React Native's StatusBar drives the activity's window only. A `Modal` is a
 * dialog window of its own, which copies the activity's bars once when it
 * opens and never again, so a toggle from inside it has to reach the dialog.
 */
class WindowStatusBarView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private var hidden = false

  fun setHidden(value: Boolean) {
    hidden = value
    apply()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    apply()
  }

  private fun apply() {
    if (!isAttachedToWindow) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      // The view's own controller belongs to its window; the compat helper would resolve the activity's.
      val controller = windowInsetsController ?: return
      controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      if (hidden) controller.hide(WindowInsets.Type.statusBars()) else controller.show(WindowInsets.Type.statusBars())
    } else {
      @Suppress("DEPRECATION")
      rootView.systemUiVisibility = if (hidden) {
        rootView.systemUiVisibility or View.SYSTEM_UI_FLAG_FULLSCREEN
      } else {
        rootView.systemUiVisibility and View.SYSTEM_UI_FLAG_FULLSCREEN.inv()
      }
    }
  }
}
