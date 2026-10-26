import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Button, Center, Loader, Stack, Text } from '@mantine/core'
import { useObserve } from './data/observable'
import { authService, SessionProvider } from './data/session'
import { CorrectionListPage } from './pages/attendance/CorrectionListPage'
import { DayDetailPage } from './pages/attendance/DayDetailPage'
import { LeaveListPage } from './pages/attendance/LeaveListPage'
import { LeaveRequestPage } from './pages/attendance/LeaveRequestPage'
import { MonthlyAttendancePage } from './pages/attendance/MonthlyAttendancePage'
import { PunchHomePage } from './pages/attendance/PunchHomePage'
import { ExpenseDetailPage } from './pages/expenses/ExpenseDetailPage'
import { ExpenseEditPage } from './pages/expenses/ExpenseEditPage'
import { ExpenseListPage } from './pages/expenses/ExpenseListPage'
import { LoginPage } from './pages/LoginPage'
import { ReportDetailPage } from './pages/reports/ReportDetailPage'
import { ReportEditorPage } from './pages/reports/ReportEditorPage'
import { ReportListPage } from './pages/reports/ReportListPage'
import { RevisionHistoryPage } from './pages/reports/RevisionHistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { TabBar } from './ui/common'

export function App() {
  const auth = useObserve(authService)
  if (!auth.isReady) {
    return (
      <Center h="100dvh">
        <Loader />
      </Center>
    )
  }
  if (!auth.user) return <LoginPage />
  // 退職にした人・アカウントの情報がない人は使えない（ルールでも読み書きが止まる）
  if (auth.profileLoaded && (!auth.profile || auth.profile.retiredAt)) {
    return (
      <Center h="100dvh" p="xl">
        <Stack align="center" gap="md">
          <Text fw={700} size="lg">
            このアカウントは利用できません
          </Text>
          <Text size="sm" c="dimmed" ta="center">
            管理者に確認してください。
          </Text>
          <Button variant="light" onClick={() => authService.signOut()}>
            ログアウト
          </Button>
        </Stack>
      </Center>
    )
  }
  return (
    <SessionProvider key={auth.user.uid} uid={auth.user.uid}>
      <MainRoutes />
    </SessionProvider>
  )
}

function MainRoutes() {
  const { pathname } = useLocation()
  // 入力画面は下に保存ボタンを出すので、タブを隠す
  const hidesTabbar = /^\/(reports\/write|expenses\/(new|edit)|attendance\/leaves\/new)/.test(pathname)
  return (
    <>
      <Routes>
        {/* ログイン後は「勤怠」が最初に開く */}
        <Route path="/" element={<PunchHomePage />} />
        <Route path="/attendance/month" element={<MonthlyAttendancePage />} />
        <Route path="/attendance/day/:date" element={<DayDetailPage />} />
        <Route path="/attendance/corrections" element={<CorrectionListPage />} />
        <Route path="/attendance/leaves" element={<LeaveListPage />} />
        <Route path="/attendance/leaves/new" element={<LeaveRequestPage />} />
        <Route path="/reports" element={<ReportListPage />} />
        <Route path="/reports/write/:date" element={<ReportEditorPage />} />
        <Route path="/reports/:id" element={<ReportDetailPage />} />
        <Route path="/reports/:id/history" element={<RevisionHistoryPage />} />
        <Route path="/expenses" element={<ExpenseListPage />} />
        <Route path="/expenses/new" element={<ExpenseEditPage />} />
        <Route path="/expenses/edit/:id" element={<ExpenseEditPage />} />
        <Route path="/expenses/:id" element={<ExpenseDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!hidesTabbar && <TabBar />}
    </>
  )
}
