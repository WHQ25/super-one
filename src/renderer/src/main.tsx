import 'electron-log/renderer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { initI18n } from './i18n'
import './styles/index.css'
import './utils/scroll-overlay'

void initI18n().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      <Toaster position="bottom-center" />
    </StrictMode>
  )
})
