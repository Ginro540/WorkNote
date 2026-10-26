import { useNavigate } from 'react-router-dom'
import { IconBeach, IconPlus } from '@tabler/icons-react'
import { groupLeaves } from '../../data/leaves'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { Empty, HeaderButton, Page } from '../../ui/common'
import { LeaveCard } from './LeaveCard'

/** 休暇の申請の一覧（新しい順。まとめて申請した日は1枚） */
export function LeaveListPage() {
  const store = useObserve(useSession().leaves)
  const navigate = useNavigate()
  const groups = groupLeaves(store.leaves)
  return (
    <Page
      title="休暇"
      back="/"
      backLabel="勤怠"
      right={
        <HeaderButton bold onClick={() => navigate('/attendance/leaves/new')}>
          <IconPlus size={20} /> 申請
        </HeaderButton>
      }
    >
      {store.isLoaded && groups.length === 0 && (
        <Empty title="休暇の申請はありません" icon={<IconBeach size={40} />}>
          右上の「申請」から、有給・特別休暇・欠勤を申請できます。
        </Empty>
      )}
      {groups.map((g) => (
        <LeaveCard key={g[0].groupId} group={g} />
      ))}
    </Page>
  )
}
