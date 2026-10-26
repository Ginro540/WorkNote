import { IconCircleCheck } from '@tabler/icons-react'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { Empty, Page } from '../../ui/common'
import { CorrectionCard } from './parts'

/** 修正申請の一覧（申請中の取り消し） */
export function CorrectionListPage() {
  const store = useObserve(useSession().attendance)
  return (
    <Page title="修正申請" back={true}>
      {store.corrections.length === 0 && (
        <Empty title="修正申請はありません" icon={<IconCircleCheck size={40} />}>
          月の勤怠で日付を選ぶと修正を申請できます。
        </Empty>
      )}
      {store.corrections.map((c) => (
        <CorrectionCard key={c.id} correction={c} showsDate />
      ))}
    </Page>
  )
}
