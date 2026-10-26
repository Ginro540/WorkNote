import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Center, Loader } from '@mantine/core'
import {
  IconArrowBackUp,
  IconBuilding,
  IconCalendar,
  IconCamera,
  IconCheck,
  IconCircleXFilled,
  IconClockCheck,
  IconCloud,
  IconCloudRain,
  IconHistory,
  IconMapPinFilled,
  IconPhoto,
  IconSend,
  IconSnowflake,
  IconSun,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { summarize } from '../../core/attendance'
import { parseTimeRange, timeRangeFromDates, timeRangeMinutes, timeRangeRaw, type TimeRange } from '../../core/timeRange'
import { dayKey, durationLabel } from '../../core/workCalendar'
import { punchPoint, ReportKey, type DailyReport, type ReportField } from '../../data/models'
import { useObserve } from '../../data/observable'
import type { ReportDraft } from '../../data/reports'
import { useSession } from '../../data/session'
import { alertMessage, Card, confirmAction, goBack, HeaderButton, Page, RequiredBadge, StoredImage, useFilePicker, useObjectUrl } from '../../ui/common'
import { colors, gradients } from '../../ui/theme'
import { SitePicker } from './SitePicker'

const weatherOptions = [
  { name: '晴れ', icon: IconSun },
  { name: '曇り', icon: IconCloud },
  { name: '雨', icon: IconCloudRain },
  { name: '雪', icon: IconSnowflake },
]

/** 日報の作成・編集：項目の入力、勤務先の選択、写真の追加、下書き保存、提出 */
export function ReportEditorPage() {
  const { date: initialDate = '' } = useParams()
  const session = useSession()
  const store = useObserve(session.reports)
  if (!store.isLoaded) {
    return (
      <Center h="100dvh">
        <Loader />
      </Center>
    )
  }
  const existing = store.reportOn(initialDate)
  // 承認済みの日報は直せないので、詳細を出す
  if (existing?.status === 'approved') return <Navigate to={`/reports/${existing.id}`} replace />
  return <Editor key={initialDate} initialDate={initialDate} existing={existing} />
}

function Editor({ initialDate, existing }: { initialDate: string; existing: DailyReport | null }) {
  const session = useSession()
  const store = session.reports
  const settings = useObserve(session.settings)
  const navigate = useNavigate()
  const [draft, setDraft] = useState<ReportDraft | null>(null)
  /** 作業時間に出勤・退勤の時刻を入れたか */
  const [fromAttendance, setFromAttendance] = useState(false)
  const [showsSites, setShowsSites] = useState(false)
  const [saving, setSaving] = useState(false)
  const isEditingSubmitted = existing?.status === 'submitted'

  /** 作業時間の初期値：その日の最初の出勤と最後の退勤 */
  const workTimeFor = async (date: string): Promise<string | null> => {
    const punches = await session.attendance.fetchPunches(date)
    const s = summarize(punches.map(punchPoint))
    return s.firstIn && s.lastOut ? timeRangeRaw(timeRangeFromDates(s.firstIn, s.lastOut)) : null
  }

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const d = store.draft(existing, initialDate)
    if (existing) {
      setDraft(d)
      return
    }
    workTimeFor(d.date).then((wt) => {
      if (wt) d.values[ReportKey.workTime] = wt
      setFromAttendance(wt !== null)
      setDraft(d)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (fn: (d: ReportDraft) => ReportDraft) => setDraft((d) => (d ? fn(d) : d))
  const setValue = (key: string, value: string | null) =>
    update((d) => {
      const values = { ...d.values }
      if (value === null) delete values[key]
      else values[key] = value
      return { ...d, values }
    })

  const changeDate = async (date: string) => {
    if (!draft || existing || !date || date > dayKey(new Date())) return
    const refill = fromAttendance || !draft.values[ReportKey.workTime]
    update((d) => ({ ...d, date }))
    if (refill) {
      const wt = await workTimeFor(date)
      setValue(ReportKey.workTime, wt)
      setFromAttendance(wt !== null)
    }
  }

  const save = async (submit: boolean) => {
    if (!draft || saving) return
    setSaving(true)
    try {
      await store.save(draft, existing, submit)
      goBack(navigate, '/reports')
    } catch (e) {
      alertMessage((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const close = () => {
    if (draft?.newPhotos.length) {
      confirmAction({ title: '保存していない写真があります', message: '閉じると、追加した写真は保存されません。', confirm: '閉じる', danger: true, onConfirm: () => goBack(navigate, '/reports') })
    } else {
      goBack(navigate, '/reports')
    }
  }

  return (
    <Page
      title={isEditingSubmitted ? '日報を修正' : '日報を書く'}
      noTabbar
      left={
        <HeaderButton onClick={close}>
          <IconX size={20} /> 閉じる
        </HeaderButton>
      }
      right={
        existing?.status === 'draft' && (
          <HeaderButton
            label="下書きを削除"
            onClick={() =>
              confirmAction({
                title: 'この下書きを削除しますか？',
                confirm: '削除',
                danger: true,
                onConfirm: () => {
                  store.deleteDraft(existing)
                  navigate('/reports', { replace: true })
                },
              })
            }
          >
            <IconTrash size={20} color="var(--mantine-color-red-6)" />
          </HeaderButton>
        )
      }
    >
      {!draft ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <>
          {existing?.status === 'draft' && existing.returnReason && (
            <div style={{ color: colors.warning, fontSize: 14, display: 'flex', gap: 6 }}>
              <IconArrowBackUp size={18} style={{ flexShrink: 0 }} /> 差し戻し：{existing.returnReason}
            </div>
          )}
          {isEditingSubmitted && (
            <div className="dimmed" style={{ fontSize: 13, display: 'flex', gap: 6 }}>
              <IconHistory size={16} style={{ flexShrink: 0 }} /> 提出済みの日報を修正すると、修正前の内容が修正履歴に残ります。
            </div>
          )}
          {settings.template.map((f) => (
            <FieldView
              key={f.key}
              field={f}
              draft={draft}
              existing={existing}
              fromAttendance={fromAttendance}
              onDate={changeDate}
              setValue={setValue}
              setTimeRange={(v) => {
                setValue(f.key, v)
                setFromAttendance(false)
              }}
              update={update}
              openSites={() => setShowsSites(true)}
            />
          ))}
        </>
      )}

      <SitePicker
        opened={showsSites}
        siteIds={draft?.siteIds ?? []}
        manualSites={draft?.manualSites ?? []}
        onClose={() => setShowsSites(false)}
        onDone={(siteIds, manualSites) => {
          update((d) => ({ ...d, siteIds, manualSites }))
          setShowsSites(false)
        }}
      />

      <div className="bottom-bar">
        {isEditingSubmitted ? (
          <button className="pill-btn" style={{ background: gradients.report }} disabled={!draft || saving} onClick={() => save(false)}>
            <IconCheck size={20} /> 修正を保存
          </button>
        ) : (
          <>
            <button className="pill-btn gray" disabled={!draft || saving} onClick={() => save(false)}>
              下書き保存
            </button>
            <button className="pill-btn" style={{ background: gradients.report }} disabled={!draft || saving} onClick={() => save(true)}>
              <IconSend size={20} /> 提出する
            </button>
          </>
        )}
      </div>
    </Page>
  )
}

function FieldView(props: {
  field: ReportField
  draft: ReportDraft
  existing: DailyReport | null
  fromAttendance: boolean
  onDate: (date: string) => void
  setValue: (key: string, value: string | null) => void
  setTimeRange: (raw: string) => void
  update: (fn: (d: ReportDraft) => ReportDraft) => void
  openSites: () => void
}) {
  const { field, draft } = props
  const settings = useObserve(useSession().settings)
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <b style={{ fontSize: 17 }}>{field.label}</b>
      {field.required && <RequiredBadge />}
    </div>
  )

  switch (field.type) {
    case 'date':
      return (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconCalendar size={20} color={colors.reportGreen} />
            <b style={{ fontSize: 17 }}>{field.label}</b>
            {/* 一度保存した日報は日付を変えない（ID が日付で決まるため） */}
            <input
              type="date"
              className="native-picker"
              style={{ marginLeft: 'auto' }}
              value={draft.date}
              max={dayKey(new Date())}
              disabled={props.existing !== null}
              onChange={(e) => props.onDate(e.target.value)}
            />
          </div>
        </Card>
      )

    case 'weather':
      return (
        <Card>
          {header}
          <div className="chips">
            {weatherOptions.map((o) => {
              const on = draft.values[field.key] === o.name
              return (
                <button key={o.name} className={`chip ${on ? 'on' : ''}`} onClick={() => props.setValue(field.key, on ? null : o.name)}>
                  <o.icon size={18} /> {o.name}
                </button>
              )
            })}
          </div>
        </Card>
      )

    case 'timeRange':
      return (
        <Card>
          {header}
          <TimeRangeEditor value={parseTimeRange(draft.values[field.key])} onChange={props.setTimeRange} />
          {props.fromAttendance && (
            <div className="dimmed" style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
              <IconClockCheck size={14} /> 出勤・退勤の時刻を入れています
            </div>
          )}
        </Card>
      )

    case 'sites':
      return (
        <Card>
          {header}
          {(draft.siteIds.length > 0 || draft.manualSites.length > 0) && (
            <div className="chips">
              {draft.siteIds.map((id) => (
                <SiteChip key={id} name={settings.site(id)?.name ?? '（削除された勤務先）'} onRemove={() => props.update((d) => ({ ...d, siteIds: d.siteIds.filter((x) => x !== id) }))} />
              ))}
              {draft.manualSites.map((name) => (
                <SiteChip key={name} name={name} onRemove={() => props.update((d) => ({ ...d, manualSites: d.manualSites.filter((x) => x !== name) }))} />
              ))}
            </div>
          )}
          <button
            className="pill-btn"
            style={{ minHeight: 48, borderRadius: 14, fontSize: 15, background: 'rgba(30,143,196,0.1)', color: colors.report }}
            onClick={props.openSites}
          >
            <IconBuilding size={18} /> 勤務先を追加・変更
          </button>
        </Card>
      )

    case 'longText':
    case 'text': {
      const placeholder =
        { [ReportKey.content]: '今日行った作業を書いてください', impressions: '気づいたこと・報告事項', tomorrow: '明日の予定' }[field.key] ?? field.label
      const value = draft.values[field.key] ?? ''
      return (
        <Card>
          {header}
          {field.type === 'longText' ? (
            <AutoTextarea placeholder={placeholder} value={value} onChange={(v) => props.setValue(field.key, v)} />
          ) : (
            <input className="field-input" placeholder={placeholder} value={value} onChange={(e) => props.setValue(field.key, e.target.value)} />
          )}
        </Card>
      )
    }

    case 'photos':
      return (
        <Card>
          {header}
          <PhotosEditor draft={draft} update={props.update} />
        </Card>
      )
  }
}

function SiteChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="chip on" style={{ cursor: 'default' }}>
      <IconMapPinFilled size={16} />
      <span className="ellipsis" style={{ maxWidth: 220 }}>
        {name}
      </span>
      <button onClick={onRemove} aria-label={`${name}を外す`} style={{ background: 'none', border: 'none', color: '#fff', padding: 0, display: 'flex', cursor: 'pointer' }}>
        <IconCircleXFilled size={18} style={{ opacity: 0.85 }} />
      </button>
    </span>
  )
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const toHm = (m: number) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`
const fromHm = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function TimeRangeEditor({ value, onChange }: { value: TimeRange | null; onChange: (raw: string) => void }) {
  const current = value ?? { start: 9 * 60, end: 18 * 60 }
  const set = (isStart: boolean, s: string) => {
    const m = fromHm(s)
    if (m === null) return
    onChange(timeRangeRaw(isStart ? { ...current, start: m } : { ...current, end: m }))
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="time" className="native-picker" value={toHm(current.start)} onChange={(e) => set(true, e.target.value)} />
      <span className="dimmed">〜</span>
      <input type="time" className="native-picker" value={toHm(current.end % 1440)} onChange={(e) => set(false, e.target.value)} />
      <span className="num" style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 700 }}>
        {value ? durationLabel(timeRangeMinutes(value)) : '--:--'}
      </span>
    </div>
  )
}

/** 入力に合わせて高さが伸びるテキスト欄（キーボードのマイクで音声入力も使える） */
function AutoTextarea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 100)}px`
  }, [value])
  return <textarea ref={ref} className="field-input" rows={4} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
}

function PhotosEditor({ draft, update }: { draft: ReportDraft; update: (fn: (d: ReportDraft) => ReportDraft) => void }) {
  const add = (files: File[]) => update((d) => ({ ...d, newPhotos: [...d.newPhotos, ...files] }))
  const camera = useFilePicker(add, { camera: true })
  const album = useFilePicker(add, { multiple: true })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {(draft.photoPaths.length > 0 || draft.newPhotos.length > 0) && (
        <div className="photo-grid">
          {draft.photoPaths.map((path) => (
            <div key={path} className="photo-tile">
              <StoredImage path={path} />
              <RemoveButton onClick={() => update((d) => ({ ...d, photoPaths: d.photoPaths.filter((p) => p !== path) }))} />
            </div>
          ))}
          {draft.newPhotos.map((file, i) => (
            <div key={i} className="photo-tile">
              <BlobImage blob={file} />
              <RemoveButton onClick={() => update((d) => ({ ...d, newPhotos: d.newPhotos.filter((_, j) => j !== i) }))} />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="pill-btn gray" style={{ flex: 1, minHeight: 44, fontSize: 15, color: 'var(--mantine-color-blue-6)' }} onClick={camera.open}>
          <IconCamera size={18} /> カメラ
        </button>
        <button className="pill-btn gray" style={{ flex: 1, minHeight: 44, fontSize: 15, color: 'var(--mantine-color-blue-6)' }} onClick={album.open}>
          <IconPhoto size={18} /> アルバム
        </button>
      </div>
      {camera.input}
      {album.input}
      <div className="dimmed" style={{ fontSize: 12 }}>
        写真は縮小してから、裏で順番に送信します。
      </div>
    </div>
  )
}

function BlobImage({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  return url ? <img src={url} alt="" /> : null
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="remove" onClick={onClick} aria-label="写真を外す">
      <IconX size={16} />
    </button>
  )
}
