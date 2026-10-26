import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './ui/app.css'
import { theme } from './ui/theme'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <ModalsProvider labels={{ confirm: 'OK', cancel: 'キャンセル' }}>
        <Notifications position="top-center" />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // 電波がなくてもアプリを開けるようにする
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service Worker error', e))
  })
}

// 保存した打刻・画像をブラウザが勝手に消さないようにお願いする（ホーム画面に追加したアプリでは通りやすい）
navigator.storage?.persist?.().catch(() => undefined)
