// ログイン状態と、ログイン中に使うデータ（設定・打刻・日報・経費）。
// 一度ログインすれば Firebase がスマホに保存し、次からは自動でログイン状態になる。

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { doc, type Unsubscribe } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { AttendanceStore } from './attendance'
import { ExpenseStore } from './expenses'
import { uploadQueue } from './images'
import { LeaveStore } from './leaves'
import { LocationService } from './location'
import { parseUser, type AppUser } from './models'
import { listenDoc, Observable } from './observable'
import { ReportStore } from './reports'
import { SettingsStore } from './settings'

export class AuthService extends Observable {
  user: User | null = null
  profile: AppUser | null = null
  /** users/{uid} を読み終えたか */
  profileLoaded = false
  isReady = false
  private profileUnsub: Unsubscribe | null = null

  constructor() {
    super()
    onAuthStateChanged(auth, (user) => this.apply(user))
  }

  private apply(user: User | null) {
    this.profileUnsub?.()
    this.profileUnsub = null
    this.user = user
    this.profile = null
    this.profileLoaded = false
    this.isReady = true
    this.changed()
    if (!user) return
    this.profileUnsub = listenDoc(doc(db, 'users', user.uid), (d) => {
      this.profile = d ? parseUser(user.uid, d) : null
      this.profileLoaded = true
      this.changed()
    })
  }

  get displayName() {
    return this.profile?.displayName || this.user?.displayName || ''
  }

  async signIn(email: string, password: string) {
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (e) {
      throw new Error(authMessage(e))
    }
  }

  async sendPasswordReset(email: string) {
    try {
      await sendPasswordResetEmail(auth, email)
    } catch (e) {
      throw new Error(authMessage(e))
    }
  }

  signOut() {
    this.profileUnsub?.()
    this.profileUnsub = null
    return signOut(auth)
  }
}

/** Firebase Authentication のエラーを日本語にする */
function authMessage(e: unknown): string {
  switch ((e as { code?: string }).code) {
    case 'auth/invalid-email':
      return 'メールアドレスの形式が正しくありません。'
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
      return 'メールアドレスまたはパスワードが違います。'
    case 'auth/user-disabled':
      return 'このアカウントは利用できません。管理者に確認してください。'
    case 'auth/too-many-requests':
      return '試行回数が多すぎます。しばらくしてからもう一度お試しください。'
    case 'auth/network-request-failed':
      return '通信できません。電波の良いところでもう一度お試しください。'
    default:
      return e instanceof Error ? e.message : String(e)
  }
}

/** ネットにつながっているか */
class NetworkMonitor extends Observable {
  isOnline = navigator.onLine

  constructor() {
    super()
    const update = () => {
      this.isOnline = navigator.onLine
      this.changed()
    }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
  }
}

export const authService = new AuthService()
export const network = new NetworkMonitor()

/** ログイン中のデータ */
export class AppSession {
  readonly uid: string
  readonly settings = new SettingsStore()
  readonly location = new LocationService()
  readonly attendance: AttendanceStore
  readonly reports: ReportStore
  readonly expenses: ExpenseStore
  readonly leaves: LeaveStore

  constructor(uid: string) {
    this.uid = uid
    this.attendance = new AttendanceStore(uid, this.settings, this.location)
    this.reports = new ReportStore(uid, this.settings)
    this.expenses = new ExpenseStore(uid, this.settings)
    this.leaves = new LeaveStore(uid, this.settings)
  }

  start() {
    this.settings.start()
    this.attendance.start()
    this.reports.start()
    this.expenses.start()
    this.leaves.start()
    uploadQueue.run()
  }

  stop() {
    this.attendance.stop()
    this.reports.stop()
    this.expenses.stop()
    this.leaves.stop()
    this.settings.stop()
  }
}

const SessionContext = createContext<AppSession | null>(null)

export function useSession(): AppSession {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession はログイン後の画面で使う')
  return s
}

export function SessionProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const [session] = useState(() => new AppSession(uid))
  useEffect(() => {
    session.start()
    // 取り消し待ちの打刻は、アプリを閉じる・裏に回す前に保存する
    const flush = () => {
      if (document.visibilityState === 'hidden') session.attendance.commitPendingNow()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') uploadQueue.run()
    }
    const onPageHide = () => session.attendance.commitPendingNow()
    document.addEventListener('visibilitychange', flush)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onPageHide)
      session.stop()
    }
  }, [session])
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}
