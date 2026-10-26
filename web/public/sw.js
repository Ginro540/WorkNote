// ワークノートの Service Worker：電波がなくてもアプリを開けるように、画面のファイルをスマホに保存する。
// データ（Firestore）はこことは別に、Firebase がスマホに保存している。

const CACHE = 'worknote-app-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      const res = await fetch('/index.html', { cache: 'no-cache' })
      const html = await res.clone().text()
      await cache.put('/index.html', res)
      // index.html が読み込むファイル（/assets/…）も先に保存する
      const assets = [...new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? [])]
      await cache.addAll([...assets, '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png'])
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // 画面の切り替え：新しい版を取りに行き、電波がなければ保存した index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(async () => (await caches.match('/index.html')) ?? Response.error()),
    )
    return
  }

  // 名前にハッシュの付いたファイルと、領収書の読み取りの仕組み（CDN）は、一度保存したらそれを使う
  const immutable = (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) || url.hostname === 'cdn.jsdelivr.net'
  if (immutable) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  // アイコンなど：保存したものをすぐ出し、裏で新しくする
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const update = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          })
          .catch(() => hit ?? Response.error())
        return hit ?? update
      }),
    )
  }
})
