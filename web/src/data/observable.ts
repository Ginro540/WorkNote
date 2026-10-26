import { useSyncExternalStore } from 'react'
import { onSnapshot, type DocumentData, type DocumentReference, type Query } from 'firebase/firestore'

/** 変わったら画面に知らせるオブジェクト（iOS 版の @Observable にあたる） */
export class Observable {
  private listeners = new Set<() => void>()
  private version = 0

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getVersion = () => this.version

  protected changed() {
    this.version++
    for (const fn of this.listeners) fn()
  }
}

/** オブジェクトが変わったら画面を描き直す */
export function useObserve<T extends Observable>(o: T): T {
  useSyncExternalStore(o.subscribe, o.getVersion)
  return o
}

/**
 * クエリを購読する。pending はまだサーバーに届いていない（オフラインで書いた）ドキュメントの ID
 */
export function listenQuery<T>(
  query: Query,
  parse: (id: string, d: DocumentData) => T | null,
  onChange: (items: T[], pending: Set<string>) => void,
) {
  return onSnapshot(
    query,
    { includeMetadataChanges: true },
    (snap) => {
      const items: T[] = []
      const pending = new Set<string>()
      for (const doc of snap.docs) {
        const item = parse(doc.id, doc.data({ serverTimestamps: 'estimate' }))
        if (item) items.push(item)
        if (doc.metadata.hasPendingWrites) pending.add(doc.id)
      }
      onChange(items, pending)
    },
    (error) => console.error('Firestore listen error', error),
  )
}

export function listenDoc(ref: DocumentReference, onChange: (d: DocumentData | undefined) => void) {
  return onSnapshot(
    ref,
    (snap) => onChange(snap.data({ serverTimestamps: 'estimate' })),
    (error) => console.error('Firestore listen error', ref.path, error),
  )
}
