import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IconAlertTriangleFilled, IconBeach, IconCalendar, IconCircleCheckFilled, IconHourglass, IconMapPinOff, IconSunrise, IconSunset } from '@tabler/icons-react'
import { punchKindLabel } from '../../core/attendance'
import { dayKey, durationLabel, jstParts, shortDayLabelFromKey, timeLabel, weekdaySymbols } from '../../core/workCalendar'
import { homeStatusLabel } from '../../data/attendance'
import { leaveKindShort } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { Card, Chevron, HeaderButton, OfflineBanner, Page, StatusBadge } from '../../ui/common'
import { colors, gradients } from '../../ui/theme'
import { PunchTimeline } from './parts'

/** 打刻（ホーム）：現在時刻と大きな出勤・退勤ボタン、今日の勤務 */
export function PunchHomePage() {
  const session = useSession()
  const now = useNow()
  const store = useObserve(session.attendance)
  const location = useObserve(session.location)
  const leaves = useObserve(session.leaves)
  const todayLeave = leaves.approvedFullDayLeaveOn(dayKey(now))
  useObserve(session.settings)
  const navigate = useNavigate()

  const isClockOut = store.nextKind === 'out'
  const statusColor = { notStarted: 'gray', working: colors.clockIn, finished: 'green' }[store.homeStatus]
  const p = jstParts(now)
  const pending = store.pendingPunch

  return (
    <Page
      title="勤怠"
      className="home-bg"
      right={
        <HeaderButton onClick={() => navigate('/attendance/month')}>
          <IconCalendar size={20} /> 月の勤怠
        </HeaderButton>
      }
    >
      <OfflineBanner />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="dimmed" style={{ fontSize: 17, fontWeight: 600 }}>
          {p.year}年{p.month}月{p.day}日 {weekdaySymbols[p.weekday - 1]}曜日
        </div>
        <div>
          <StatusBadge text={homeStatusLabel[store.homeStatus]} color={statusColor} />
        </div>
        <div className="clock">
          <span className="hm">{timeLabel(now)}</span>
          <span className="s">{String(now.getSeconds()).padStart(2, '0')}</span>
        </div>
      </div>

      {store.missingPunchDays.map((day) => (
        <Link key={day} to={`/attendance/day/${day}`} className="banner warn">
          <IconAlertTriangleFilled size={20} color={colors.warning} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{shortDayLabelFromKey(day)} 退勤漏れ</div>
            <div className="sub">修正申請で正しい時刻を入れてください</div>
          </div>
          <Chevron />
        </Link>
      ))}

      {location.isDenied && (
        <div className="banner plain">
          <IconMapPinOff size={20} className="dimmed" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700 }}>位置情報がオフです</div>
            <div className="sub">
              打刻場所を記録するため、ブラウザ（またはスマホの設定）でこのサイトの位置情報を「許可」にしてください。
            </div>
          </div>
        </div>
      )}

      {leaves.pendingCount > 0 && (
        <Link to="/attendance/leaves" className="banner plain">
          <IconHourglass size={20} color={colors.warning} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, fontWeight: 600 }}>申請中の休暇 {leaves.pendingCount}件</div>
          <Chevron />
        </Link>
      )}

      {/* 承認された全日の休暇の日。急に出勤した場合のため、打刻はできるままにする */}
      {todayLeave && (
        <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, color: colors.reportGreen }}>
          今日は{leaveKindShort[todayLeave.kind]}です
        </div>
      )}

      <div className="punch-wrap">
        <button
          className="punch-btn"
          style={
            {
              background: isClockOut ? gradients.clockOut : gradients.clockIn,
              boxShadow: `0 12px 24px ${isClockOut ? 'rgba(255,154,60,0.45)' : 'rgba(79,123,247,0.45)'}`,
              '--halo': isClockOut ? 'rgba(255,154,60,0.15)' : 'rgba(79,123,247,0.15)',
            } as React.CSSProperties
          }
          onClick={() => {
            navigator.vibrate?.(15)
            store.tapPunch()
          }}
          aria-label={`${store.buttonLabel}を打刻`}
        >
          {isClockOut ? <IconSunset size={40} /> : <IconSunrise size={40} />}
          <span className="label">{store.buttonLabel}</span>
          <span className="hint">タップで打刻</span>
        </button>
      </div>

      <TodayWorkCard workDate={store.timelineWorkDate} />

      <div style={{ display: 'flex', gap: 12 }}>
        <Link to="/attendance/leaves/new" className="link-card" style={{ flex: 1, justifyContent: 'center', fontWeight: 600 }}>
          <IconBeach size={20} color={colors.reportGreen} /> 休暇を申請
        </Link>
        <Link to="/attendance/leaves" className="link-card" style={{ flex: 1, justifyContent: 'center', fontWeight: 600 }}>
          休暇の一覧
        </Link>
      </div>

      {pending && (
        <div className="toast">
          <IconCircleCheckFilled size={22} color={pending.kind === 'in' ? colors.clockIn : colors.clockOut} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {timeLabel(pending.time)} に{punchKindLabel(pending.kind)}しました
          </span>
          <button className="header-btn" style={{ marginLeft: 'auto', fontWeight: 700 }} onClick={() => store.undoPunch()}>
            取り消す
          </button>
        </div>
      )}
    </Page>
  )
}

/** 今日の勤務：打刻を点と線でつないで表示し、打刻場所の住所も出す */
function TodayWorkCard({ workDate }: { workDate: string }) {
  const store = useObserve(useSession().attendance)
  const punches = store.punchesOn(workDate)
  const summary = store.summary(workDate)
  const isToday = workDate === dayKey(new Date())
  return (
    <Card style={{ padding: 20 }}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{isToday ? '今日の勤務' : `勤務中（${shortDayLabelFromKey(workDate)}から）`}</div>
      {punches.length === 0 ? (
        <div className="dimmed" style={{ fontSize: 14 }}>
          まだ打刻していません
        </div>
      ) : (
        <>
          <PunchTimeline punches={punches} unsentIds={store.unsentPunchIds} />
          {summary.workMinutes !== null && (
            <>
              <div className="divider" />
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <div>
                  <div className="dimmed" style={{ fontSize: 12 }}>
                    実働
                  </div>
                  <div className="dimmed" style={{ fontSize: 11 }}>
                    休憩 {durationLabel(summary.deductedBreakMinutes ?? 0)} を差し引き
                  </div>
                </div>
                <span className="num" style={{ marginLeft: 'auto', fontSize: 34, fontWeight: 700 }}>
                  {durationLabel(summary.workMinutes)}
                </span>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  )
}

/** 1秒ごとに今の時刻 */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}
