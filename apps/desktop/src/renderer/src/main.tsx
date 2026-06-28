import 'electron-log/renderer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { MiniWindowApp } from './components/MiniWindowApp'
import { DragPreviewApp } from './components/DragPreviewApp'
import { initI18n } from './i18n'
import './styles/index.css'
import './utils/scroll-overlay'

const params = new URLSearchParams(window.location.search)
const mode = params.get('mode')
const isMiniWindow = mode === 'miniwindow'
const isDragPreview = mode === 'dragpreview'
const miniProject = params.get('project')
const miniSession = params.get('session')
const miniTitle = params.get('title')

void initI18n().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {isDragPreview
        ? <DragPreviewApp />
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
