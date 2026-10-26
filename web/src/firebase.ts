import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// Firebase の Web アプリの設定（管理者アプリと同じ値。公開して問題ない値で、データはログインとセキュリティルールで守る）
export const firebaseConfig = {
  apiKey: 'AIzaSyDoybwLpK7HzRyz2c1kBorO42iJYPWWBSk',
  authDomain: 'worknote-6dc51.firebaseapp.com',
  projectId: 'worknote-6dc51',
  storageBucket: 'worknote-6dc51.firebasestorage.app',
  messagingSenderId: '107437839909',
  appId: '1:107437839909:web:2cb44a49b54bcc471391cc',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
auth.languageCode = 'ja'

// 読み書きしたデータはスマホに保存する。電波がなくても打刻・入力でき、つながったら自動で送信される
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const storage = getStorage(app)
