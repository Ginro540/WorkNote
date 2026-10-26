import { useState } from 'react'
import { Button, Modal, TextInput } from '@mantine/core'
import { IconCircle, IconCircleCheckFilled, IconMapPinFilled, IconPencil, IconSearch, IconTrash } from '@tabler/icons-react'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { colors } from '../../ui/theme'

/** 勤務先を選ぶ：管理者が登録した一覧から選ぶ（複数可）。名前・住所で検索。一覧にない現場は手入力 */
export function SitePicker(props: {
  opened: boolean
  siteIds: string[]
  manualSites: string[]
  onClose: () => void
  onDone: (siteIds: string[], manualSites: string[]) => void
}) {
  return (
    <Modal opened={props.opened} onClose={props.onClose} fullScreen title="勤務先を選ぶ" transitionProps={{ transition: 'slide-up' }}>
      {props.opened && <PickerBody {...props} />}
    </Modal>
  )
}

function PickerBody(props: { siteIds: string[]; manualSites: string[]; onClose: () => void; onDone: (siteIds: string[], manualSites: string[]) => void }) {
  const settings = useObserve(useSession().settings)
  const [selected, setSelected] = useState(props.siteIds)
  const [manual, setManual] = useState(props.manualSites)
  const [q, setQ] = useState('')
  const [newSite, setNewSite] = useState('')

  const query = q.trim().toLowerCase()
  const filtered = query ? settings.sites.filter((s) => s.name.toLowerCase().includes(query) || s.address.toLowerCase().includes(query)) : settings.sites

  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  const addManual = () => {
    const name = newSite.trim()
    if (!name || manual.includes(name)) return
    setManual([...manual, name])
    setNewSite('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 96 }}>
      <TextInput leftSection={<IconSearch size={16} />} placeholder="名前・住所で探す" value={q} onChange={(e) => setQ(e.currentTarget.value)} />

      <div className="section-title">勤務先の一覧</div>
      <div className="card list" style={{ background: 'var(--fill-soft)' }}>
        {settings.sites.length === 0 && <div className="row dimmed">登録されている勤務先はありません</div>}
        {settings.sites.length > 0 && filtered.length === 0 && <div className="row dimmed">「{q}」に当たる勤務先はありません</div>}
        {filtered.map((s) => {
          const on = selected.includes(s.id)
          return (
            <button key={s.id} className="row" style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => toggle(s.id)}>
              <IconMapPinFilled size={26} color={colors.reportGreen} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block' }}>{s.name}</span>
                <span className="dimmed" style={{ display: 'block', fontSize: 12 }}>
                  {s.address}
                </span>
              </span>
              {on ? <IconCircleCheckFilled size={26} color={colors.report} /> : <IconCircle size={26} color="var(--tertiary)" />}
            </button>
          )
        })}
      </div>

      <div className="section-title">一覧にない場合</div>
      <div className="card list" style={{ background: 'var(--fill-soft)' }}>
        {manual.map((name) => (
          <div key={name} className="row">
            <IconPencil size={18} className="dimmed" />
            <span style={{ flex: 1 }}>{name}</span>
            <button className="header-btn" style={{ color: 'var(--mantine-color-red-6)' }} onClick={() => setManual(manual.filter((m) => m !== name))} aria-label={`${name}を外す`}>
              <IconTrash size={18} />
            </button>
          </div>
        ))}
        <div className="row">
          <input
            className="inline-input"
            style={{ textAlign: 'left' }}
            placeholder="一覧にない勤務先を入力"
            value={newSite}
            onChange={(e) => setNewSite(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addManual()}
          />
          <button className="header-btn" onClick={addManual} disabled={newSite.trim() === ''}>
            追加
          </button>
        </div>
      </div>
      <div className="dimmed" style={{ fontSize: 12, paddingLeft: 6 }}>
        一覧への登録は管理者が行います。
      </div>

      <div className="bottom-bar" style={{ zIndex: 1000 }}>
        <Button variant="default" size="lg" radius="xl" onClick={props.onClose}>
          キャンセル
        </Button>
        <Button size="lg" radius="xl" onClick={() => props.onDone(selected, manual)}>
          決定（{selected.length + manual.length}件）
        </Button>
      </div>
    </div>
  )
}
