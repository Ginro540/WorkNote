// 日報の写真・領収書の画像。
// 画像はまずスマホ（ブラウザの IndexedDB）に保存し、裏で順番に Cloud Storage へ送る。
// Cloud Storage を使えるようになるまで（settings/company.imageUploadEnabled が false の間）は送らずにスマホに置いておく。

import { getBlob, ref, uploadBytes } from 'firebase/storage'
import { auth, storage } from '../firebase'
import { Observable } from './observable'

// MARK: - スマホの中の保存場所

const DB_NAME = 'worknote-images'
const IMAGES = 'images'
const PENDING = 'pending'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IMAGES)
      req.result.createObjectStore(PENDING)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.oncomplete = () => resolve(req.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export const localImage = (path: string) => tx<Blob | undefined>(IMAGES, 'readonly', (s) => s.get(path))

/** 画像を読む（スマホになければ Cloud Storage から読んでスマホに残す） */
export async function loadImage(path: string): Promise<Blob> {
  const local = await localImage(path).catch(() => undefined)
  if (local) return local
  const blob = await getBlob(ref(storage, path))
  await tx(IMAGES, 'readwrite', (s) => s.put(blob, path)).catch(() => undefined)
  return blob
}

// MARK: - 送信待ち

class UploadQueue extends Observable {
  pendingPaths: string[] = []
  private isRunning = false
  private enabled = false

  constructor() {
    super()
    tx<IDBValidKey[]>(PENDING, 'readonly', (s) => s.getAllKeys())
      .then((keys) => {
        this.pendingPaths = keys.map(String)
        this.changed()
        this.run()
      })
      .catch((e) => console.error('UploadQueue load error', e))
    window.addEventListener('online', () => this.run())
  }

  get isEnabled() {
    return this.enabled
  }

  /** Cloud Storage へ送るか。true になったら、たまっている画像を送り始める */
  setEnabled(value: boolean) {
    if (this.enabled === value) return
    this.enabled = value
    this.changed()
    if (value) this.run()
  }

  /** 画像をスマホに保存して送信待ちに入れる */
  async enqueue(blob: Blob, path: string) {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction([IMAGES, PENDING], 'readwrite')
      t.objectStore(IMAGES).put(blob, path)
      t.objectStore(PENDING).put(Date.now(), path)
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error ?? new Error('画像を保存できませんでした（スマホの空き容量を確認してください）'))
    })
    if (!this.pendingPaths.includes(path)) {
      this.pendingPaths = [...this.pendingPaths, path]
      this.changed()
    }
    this.run()
  }

  isPending(path: string) {
    return this.pendingPaths.includes(path)
  }

  async run() {
    const uid = auth.currentUser?.uid
    if (!this.enabled || this.isRunning || !uid) return
    this.isRunning = true
    try {
      const skipped = new Set<string>()
      for (;;) {
        const path = this.pendingPaths.find((p) => !skipped.has(p))
        if (!path) break
        // 別のユーザーの送信待ちは、そのユーザーがログインしたときに送る
        if (path.split('/')[1] !== uid) {
          skipped.add(path)
          continue
        }
        const blob = await localImage(path).catch(() => undefined)
        if (!blob) {
          await this.remove(path)
          continue
        }
        try {
          await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg' })
          await this.remove(path)
        } catch (e) {
          const code = (e as { code?: string }).code ?? ''
          if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
            console.error('Upload rejected', path, e)
            skipped.add(path)
          } else {
            // 電波がないなど。つながったときに再開する
            console.warn('Upload paused', path, e)
            return
          }
        }
      }
    } finally {
      this.isRunning = false
    }
  }

  private async remove(path: string) {
    await tx(PENDING, 'readwrite', (s) => s.delete(path)).catch(() => undefined)
    this.pendingPaths = this.pendingPaths.filter((p) => p !== path)
    this.changed()
  }
}

export const uploadQueue = new UploadQueue()

// MARK: - 縮小

/** 長辺を maxLength 以下に縮小して JPEG にする */
export async function toJpeg(file: Blob, maxLength: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxLength / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を変換できませんでした'))), 'image/jpeg', quality),
  )
}

/** 日報の写真（長辺 2000px 程度） */
export const reportPhoto = (file: Blob) => toJpeg(file, 2000, 0.8)

/** 領収書（文字が読める解像度を保つ） */
export const receiptImage = (file: Blob) => toJpeg(file, 3000, 0.85)
