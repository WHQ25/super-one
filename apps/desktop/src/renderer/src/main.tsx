import 'electron-log/renderer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { MiniWindowApp } from './components/MiniWindowApp'
import { DragPreviewApp } from './components/DragPreviewApp'
import { ComputerUsePermissionFloat } from './components/ComputerUsePermissionFloat'
import { initI18n } from './i18n'
import './styles/index.css'
import './utils/scroll-overlay'

const params = new URLSearchParams(window.location.search)
const mode = params.get('mode')
const isMiniWindow = mode === 'miniwindow'
const isDragPreview = mode === 'dragpreview'
const isComputerUsePermissions = mode === 'computer-use-permissions'
const miniProject = params.get('project')
const miniSession = params.get('session')
const miniTitle = params.get('title')

if (isDragPreview || isComputerUsePermissions) {
  // Beat global body { background-color: var(--background) } so the panel
  // window does not paint a full-window card behind the float content.
  for (const el of [document.documentElement, document.body]) {
    el.style.setProperty('background', 'transparent', 'important')
    el.style.setProperty('background-color', 'transparent', 'important')
  }
  document.documentElement.classList.add('cu-transparent-shell')
}

void initI18n().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {isDragPreview
        ? <DragPreviewApp />
        : isComputerUsePermissions
          ? <ComputerUsePermissionFloat />
          : isMiniWindow && miniProject && miniSession
            ? (
              <>
                <MiniWindowApp projectPath={miniProject} sessionId={miniSession} initialTitle={miniTitle ?? undefined} />
                <Toaster position="bottom-center" />
              </>
            )
            : (
              <>
                <App />
                <Toaster position="bottom-center" />
              </>
            )}
    </StrictMode>
  )
})
