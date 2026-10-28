import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles.css'

let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined
if (import.meta.env.MODE === 'app') {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh: () => window.dispatchEvent(new Event('viewer:update')),
      onOfflineReady: () => window.dispatchEvent(new Event('viewer:offline-ready'))
    })
  })
  window.addEventListener('viewer:apply-update', () => { void updateServiceWorker?.(true) })
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
