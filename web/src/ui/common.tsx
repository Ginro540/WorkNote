import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { Loader } from '@mantine/core'
import { modals } from '@mantine/modals'
import {
  IconChevronLeft,
  IconChevronRight,
  IconClockFilled,
  IconCloudOff,
  IconCurrencyYen,
  IconDeviceMobile,
  IconFileTextFilled,
  IconPhoto,
  IconSettingsFilled,
  IconUpload,
  IconWifiOff,
  IconX,
} from '@tabler/icons-react'
import { loadImage, uploadQueue } from '../data/images'
import { useObserve } from '../data/observable'
import { network } from '../data/session'
import { categoryStyle } from './theme'

// MARK: - 画面の枠

export function Page(props: {
  title: string
  /** 戻るボタン。文字列ならその場所へ、true なら1つ前へ */
  back?: string | true
  backLabel?: string
  left?: ReactNode
  right?: ReactNode
  /** 見出しを大きく出す（タブの最初の画面） */
  large?: boolean
  noTabbar?: boolean
  className?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const back = () => {
    if (props.back === true) goBack(navigate, '/')
    else if (props.back) navigate(props.back)
  }
  return (
    <div className={`page ${props.noTabbar ? 'no-tabbar' : ''} ${props.className ?? ''}`}>
      <header className="page-header">
        <div className="left">
          {props.back && (
            <button className="header-btn" onClick={back}>
              <IconChevronLeft size={22} stroke={2.2} />
              {props.backLabel ?? '戻る'}
            </button>
          )}
          {props.left}
        </div>
        <div className="title">{props.large ? '' : props.title}</div>
        <div className="right">{props.right}</div>
      </header>
      <main className="page-body">
        {props.large && <div className="large-title">{props.title}</div>}
        {props.children}
      </main>
    </div>
  )
}

export function TabBar() {
  const { pathname } = useLocation()
  const tabs = [
    { to: '/', label: '勤怠', icon: IconClockFilled, end: true },
    { to: '/reports', label: '日報', icon: IconFileTextFilled },
    { to: '/expenses', label: '経費', icon: IconCurrencyYen },
    { to: '/settings', label: '設定', icon: IconSettingsFilled },
  ]
  return (
    <nav className="tabbar">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive || (t.to === '/' && pathname.startsWith('/attendance')) ? 'active' : '')}>
          <t.icon size={26} />
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function HeaderButton(props: { onClick: () => void; children: ReactNode; disabled?: boolean; bold?: boolean; label?: string }) {
  return (
    <button className="header-btn" onClick={props.onClick} disabled={props.disabled} aria-label={props.label} style={props.bold ? { fontWeight: 700 } : undefined}>
      {props.children}
    </button>
  )
}

// MARK: - 部品

export function Card(props: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`card ${props.className ?? ''}`} style={props.style}>
      {props.children}
    </div>
  )
}

/** 状態の札（下書き・提出済みなど） */
export function StatusBadge({ text, color }: { text: string; color: string }) {
  const c = color.startsWith('#') ? color : `var(--mantine-color-${color}-6)`
  return (
    <span className="badge" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
      {text}
    </span>
  )
}

export const RequiredBadge = () => <span className="required">必須</span>

/** まだクラウドに送っていない印 */
export const UnsentMark = () => (
  <span className="unsent">
    <IconCloudOff size={13} />
    未送信
  </span>
)

export const Chevron = () => <IconChevronRight size={18} className="chevron" />

/** オフラインのお知らせ */
export function OfflineBanner() {
  const net = useObserve(network)
  const uploads = useObserve(uploadQueue)
  if (!net.isOnline) {
    return (
      <div className="banner offline">
        <IconWifiOff size={18} style={{ flexShrink: 0 }} />
        オフラインです。入力した内容はスマホに保存し、つながったら自動で送信します。
      </div>
    )
  }
  if (uploads.pendingPaths.length && !uploads.isEnabled) {
    return (
      <div className="dimmed" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
        <IconDeviceMobile size={16} style={{ flexShrink: 0 }} />
        写真・領収書の画像はこのスマホに保存しています（クラウドへの保存は準備中）
      </div>
    )
  }
  if (uploads.pendingPaths.length) {
    return (
      <div className="dimmed" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
        <IconUpload size={16} />
        画像を送信中（残り{uploads.pendingPaths.length}枚）
      </div>
    )
  }
  return null
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div className="t">{title}</div>
      {children && <div style={{ fontSize: 14 }}>{children}</div>}
    </div>
  )
}

export function CategoryIcon({ categoryId, size = 44 }: { categoryId: string; size?: number }) {
  const s = categoryStyle(categoryId)
  return (
    <span className="cat-icon" style={{ width: size, height: size, borderRadius: size * 0.27, background: s.color }}>
      <s.icon size={size * 0.5} stroke={2} />
    </span>
  )
}

// MARK: - 画像

/** Blob を画面に出す URL（使い終わったら解放する） */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** 保存した画像（スマホにあればそれを使う） */
export function useStoredImage(path: string | null): { blob: Blob | null; failed: boolean } {
  const [state, setState] = useState<{ blob: Blob | null; failed: boolean }>({ blob: null, failed: false })
  useEffect(() => {
    if (!path) return
    let alive = true
    setState({ blob: null, failed: false })
    loadImage(path)
      .then((blob) => alive && setState({ blob, failed: false }))
      .catch(() => alive && setState({ blob: null, failed: true }))
    return () => {
      alive = false
    }
  }, [path])
  return state
}

export function StoredImage({ path, onClick, fit = 'cover' }: { path: string; onClick?: (blob: Blob) => void; fit?: 'cover' | 'contain' }) {
  const { blob, failed } = useStoredImage(path)
  const url = useObjectUrl(blob)
  if (failed) {
    return (
      <div className="image-missing">
        <IconPhoto size={22} />
        この端末にない画像です
      </div>
    )
  }
  if (!url) {
    return (
      <div className="image-missing">
        <Loader size="sm" />
      </div>
    )
  }
  return <img src={url} alt="" style={{ objectFit: fit, cursor: onClick ? 'zoom-in' : undefined }} onClick={() => blob && onClick?.(blob)} />
}

/** 画像を全画面で見る（2本指で拡大） */
export function openImageViewer(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const id = modals.open({
    fullScreen: true,
    withCloseButton: false,
    padding: 0,
    onClose: () => URL.revokeObjectURL(url),
    children: (
      <div className="viewer">
        <div className="bar">
          <button className="header-btn" style={{ color: '#fff' }} onClick={() => modals.close(id)}>
            <IconX size={20} /> 閉じる
          </button>
        </div>
        <div className="img-wrap">
          <img src={url} alt="" />
        </div>
      </div>
    ),
  })
}

// MARK: - 確認・お知らせ

export function alertMessage(message: string, title = '確認してください') {
  modals.open({
    title,
    centered: true,
    children: (
      <div>
        <div className="pre" style={{ fontSize: 15 }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="header-btn" style={{ fontWeight: 700 }} onClick={() => modals.closeAll()}>
            OK
          </button>
        </div>
      </div>
    ),
  })
}

export function confirmAction(opts: { title: string; message?: string; confirm: string; danger?: boolean; onConfirm: () => void }) {
  modals.openConfirmModal({
    title: opts.title,
    centered: true,
    children: opts.message ? <div style={{ fontSize: 14 }}>{opts.message}</div> : null,
    labels: { confirm: opts.confirm, cancel: 'キャンセル' },
    confirmProps: { color: opts.danger ? 'red' : 'blue' },
    onConfirm: opts.onConfirm,
  })
}

export function LoadingOverlay({ text, progress }: { text: string; progress?: number | null }) {
  return (
    <div className="loading-overlay">
      <div className="box">
        <Loader />
        <div style={{ fontSize: 14 }}>{text}</div>
        {progress != null && <div className="dimmed num" style={{ fontSize: 12 }}>{Math.round(progress * 100)}%</div>}
      </div>
    </div>
  )
}

// MARK: - 写真を選ぶ

/** カメラ・アルバムから画像を選ぶ（スマホのブラウザの機能を使う） */
export function useFilePicker(onFiles: (files: File[]) => void, opts: { camera?: boolean; multiple?: boolean } = {}) {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      capture={opts.camera ? 'environment' : undefined}
      multiple={opts.multiple}
      style={{ display: 'none' }}
      onChange={(e) => {
        const files = [...(e.target.files ?? [])]
        e.target.value = ''
        if (files.length) onFiles(files)
      }}
    />
  )
  return { open: () => ref.current?.click(), input }
}

/** 1つ前の画面に戻る（アプリの中で前の画面がなければ fallback へ） */
export function goBack(navigate: NavigateFunction, fallback: string) {
  if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1)
  else navigate(fallback, { replace: true })
}
