import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DiscordLogo } from '@/components/discord-logo'
import { signIn } from './actions'

/** What to tell a member whose sign-in failed, by the error Better Auth sends back. */
const SIGN_IN_ERRORS: Record<string, string> = {
  not_in_server:
    'Your Discord account is not in the Digital Ground Game Discord server. Join the server, then sign in again.',
  discord_unavailable: 'Discord did not answer. Try signing in again in a minute.',
  discord_only: 'Sign in with Discord.',
}

function signInError(error: string | string[] | undefined): string | null {
  if (typeof error !== 'string') return null
  return SIGN_IN_ERRORS[error.toLowerCase()] ?? 'Sign-in did not work. Try again.'
}

/** Discord sign-in, coming back to returnTo afterwards. */
export function SignInCard({
  title,
  description,
  error,
  returnTo,
}: {
  title: string
  description: string
  error: string | string[] | undefined
  returnTo: string
}) {
  const message = signInError(error)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message !== null && (
          <Alert variant="destructive">
            <AlertTitle>Could not sign you in</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        <form action={signIn}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button
            type="submit"
            size="lg"
            className="h-11 gap-2.5 bg-discord px-5 text-base text-white hover:bg-discord-hover focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-discord focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <DiscordLogo className="size-6" />
            Sign in with Discord
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
