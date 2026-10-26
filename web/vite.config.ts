import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

const pad2 = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const built = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.${pad2(now.getHours())}${pad2(now.getMinutes())}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 設定画面に出すバージョン（package.json の version と作った日時）
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version}（${built}）`) },
  // Firebase Hosting の公開フォルダーは firebase.json と同じフォルダーの中にないといけない
  build: { outDir: '../firebase/hosting', emptyOutDir: true },
})
