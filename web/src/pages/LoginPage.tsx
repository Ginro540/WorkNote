import { useState } from 'react'
import { Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconClockCheck, IconLock, IconMail } from '@tabler/icons-react'
import { authService } from '../data/session'
import { alertMessage } from '../ui/common'
import { colors, gradients } from '../ui/theme'

/** ログイン：会社から発行されたメールアドレスとパスワード。アプリからの新規登録はできない。 */
export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const canSignIn = email.trim() !== '' && password !== '' && !signingIn

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSignIn) return
    setSigningIn(true)
    try {
      await authService.signIn(email.trim(), password)
    } catch (err) {
      alertMessage((err as Error).message)
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: gradients.login, padding: '0 24px 40px' }}>
      <Stack align="center" gap={14} pt="calc(env(safe-area-inset-top) + 64px)" pb={28}>
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: 26,
            background: 'rgba(255,255,255,0.22)',
            border: '1px solid rgba(255,255,255,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconClockCheck size={48} color="#fff" />
        </div>
        <Text c="white" fz={36} fw={900}>
          ワークノート
        </Text>
        <Text c="rgba(255,255,255,0.9)" fz="sm">
          勤怠・日報・経費を、これひとつで
        </Text>
      </Stack>

      <form
        onSubmit={signIn}
        style={{ background: '#fff', borderRadius: 32, padding: 24, maxWidth: 420, margin: '0 auto', boxShadow: '0 10px 20px rgba(0,0,0,0.12)' }}
        data-mantine-color-scheme="light"
      >
        <Stack gap={16}>
          <TextInput
            size="lg"
            radius={18}
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            placeholder="メールアドレス"
            leftSection={<IconMail size={20} color={colors.accent} />}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            size="lg"
            radius={18}
            autoComplete="current-password"
            placeholder="パスワード"
            leftSection={<IconLock size={20} color={colors.accent} />}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <button type="submit" className="pill-btn" style={{ background: gradients.clockIn, opacity: canSignIn ? 1 : 0.35 }} disabled={!canSignIn}>
            {signingIn ? 'ログイン中…' : 'ログイン'}
          </button>
          <Button variant="subtle" color="#5B45C9" onClick={() => openPasswordReset(email)}>
            パスワードを忘れた場合
          </Button>
        </Stack>
      </form>

      <Text ta="center" c="rgba(255,255,255,0.85)" fz="sm" mt={24}>
        アカウントは会社から発行されます
      </Text>
    </div>
  )
}

function openPasswordReset(initialEmail: string) {
  modals.open({ title: 'パスワードの再設定', centered: true, children: <PasswordReset initialEmail={initialEmail} /> })
}

/** パスワードの再設定メールを送る */
function PasswordReset({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      await authService.sendPasswordReset(email.trim())
      setSent(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Stack>
      <TextInput type="email" autoComplete="username" autoCapitalize="none" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
      <Text size="sm" c="dimmed">
        {sent
          ? '再設定のメールを送りました。メールに書かれた手順でパスワードを設定し直してください。'
          : '入力したメールアドレスに、パスワードを設定し直すためのメールを送ります。'}
      </Text>
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      <Button onClick={send} loading={sending} disabled={email.trim() === ''}>
        {sent ? 'もう一度送る' : '再設定メールを送る'}
      </Button>
    </Stack>
  )
}
