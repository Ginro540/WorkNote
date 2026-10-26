import { useObserve } from '../data/observable'
import { uploadQueue } from '../data/images'
import { roleLabel } from '../data/models'
import { authService, useSession } from '../data/session'
import { confirmAction, Page } from '../ui/common'

/** 設定：名前・メールアドレス・権限、ログアウト、アプリのバージョン */
export function SettingsPage() {
  const auth = useObserve(authService)
  const uploads = useObserve(uploadQueue)
  const session = useSession()

  const logout = () =>
    confirmAction({
      title: 'ログアウトしますか？',
      confirm: 'ログアウト',
      danger: true,
      onConfirm: () => {
        session.attendance.commitPendingNow()
        authService.signOut()
      },
    })

  const rows: [string, string][] = [
    ['名前', auth.displayName],
    ['メールアドレス', auth.profile?.email || auth.user?.email || ''],
    ['権限', auth.profile ? roleLabel(auth.profile.role) : '従業員'],
  ]

  return (
    <Page title="設定" large>
      <div className="section-title">アカウント</div>
      <div className="card list">
        {rows.map(([label, value]) => (
          <div key={label} className="row">
            <span>{label}</span>
            <span className="dimmed ellipsis" style={{ marginLeft: 'auto' }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      <div className="card list">
        <button className="row header-btn" style={{ color: 'var(--mantine-color-red-6)', justifyContent: 'center', width: '100%' }} onClick={logout}>
          ログアウト
        </button>
      </div>
      {uploads.pendingPaths.length > 0 && (
        <div className="dimmed" style={{ fontSize: 12, padding: '0 6px' }}>
          {uploads.isEnabled
            ? `送信待ちの画像が${uploads.pendingPaths.length}枚あります。電波のあるところで送信が終わってからログアウトしてください。`
            : `写真・領収書の画像${uploads.pendingPaths.length}枚はこのスマホのブラウザにだけ保存されています。ログアウトしても消えませんが、ブラウザのデータを消すと消えます。`}
        </div>
      )}

      <div className="section-title">ホーム画面に追加</div>
      <div className="card" style={{ fontSize: 14, gap: 8 }}>
        <div>
          <b>iPhone</b>：Safari で開き、共有ボタン →「ホーム画面に追加」
        </div>
        <div>
          <b>Android</b>：Chrome で開き、右上の︙ →「ホーム画面に追加」（または「アプリをインストール」）
        </div>
        <div className="dimmed" style={{ fontSize: 12 }}>
          ホーム画面から開くと、アプリと同じように全画面で使えます。打刻の記録もスマホに残りやすくなります。
        </div>
      </div>

      <div className="card list">
        <div className="row">
          <span>バージョン</span>
          <span className="dimmed" style={{ marginLeft: 'auto' }}>
            {__APP_VERSION__}
          </span>
        </div>
      </div>
    </Page>
  )
}
