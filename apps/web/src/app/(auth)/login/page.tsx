'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { TelegramLoginButton } from '@/components/telegram-login-button'

export default function LoginPage() {
  const router = useRouter()
  const t = useTranslations('Auth.login')
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

  return (
    <AuthShell
      title={t('welcomeBack')}
      description={t('description')}
      footer={
        <>
          {t('newHere')}{' '}
          <Link href="/signup" className="font-medium text-foreground hover:underline">
            {t('createAccount')}
          </Link>
        </>
      }
    >
      {botUsername ? (
        <div className="flex flex-col items-center gap-4">
          <TelegramLoginButton
            botUsername={botUsername}
            buttonSize="large"
            redirectTo="/cabinet"
            onSignupRequired={(ticket) => {
              toast.error(t('noAccountFound'))
              router.push(`/signup?ticket=${ticket}`)
            }}
          />
          <p className="text-center text-sm text-muted-foreground">{t('sameAccount')}</p>
        </div>
      ) : (
        <p className="text-center text-sm text-destructive">{t('notConfigured')}</p>
      )}
    </AuthShell>
  )
}
