import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getDb } from '@/db'
import { currentMember } from '@/lib/session'
import { codesForUser, type CodeInfo } from '@/services/codes'
import { listEnabledProjects } from '@/services/projects'
import { signIn, signOut } from './actions'
import { CodeButton } from './code-button'

/** What to tell a member whose sign-in failed, by the error Better Auth sends back. */
const SIGN_IN_ERRORS: Record<string, string> = {
  not_in_server:
    'Your Discord account is not in the DGG Discord server. Join the server, then sign in again.',
  discord_unavailable: 'Discord did not answer. Try signing in again in a minute.',
  discord_only: 'Sign in with Discord.',
}

function signInError(error: string | string[] | undefined): string | null {
  if (typeof error !== 'string') return null
  return SIGN_IN_ERRORS[error.toLowerCase()] ?? 'Sign-in did not work. Try again.'
}

function codeStatus(code: CodeInfo | undefined): string {
  if (code === undefined) return 'No code yet.'
  if (code.revokedAt !== null) return 'Your code was turned off. Get a new one to keep using it.'
  if (code.lastUsedAt !== null) return `Code last used ${code.lastUsedAt.toUTCString()}.`
  return `Code issued ${code.issuedAt.toUTCString()}, not used yet.`
}

export default async function Home({ searchParams }: PageProps<'/'>) {
  const member = await currentMember()

  if (member === null) {
    const error = signInError((await searchParams).error)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Codes for DGG tools</CardTitle>
          <CardDescription>
            Sign in with Discord to get a code for each Digital Ground Game tool you use, like the
            Hindsight OBS plugin. You need to be in the DGG Discord server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error !== null && (
            <Alert variant="destructive">
              <AlertTitle>Could not sign you in</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form action={signIn}>
            <Button type="submit" size="lg">
              Sign in with Discord
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  const db = getDb()
  const [projects, codes] = await Promise.all([
    listEnabledProjects(db),
    codesForUser(db, member.id),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          Signed in as <strong>{member.discordUsername}</strong>.
        </p>
        <div className="flex items-center gap-2">
          {member.isAdmin && (
            <Button variant="outline" nativeButton={false} render={<a href="/admin" />}>
              Admin
            </Button>
          )}
          <form action={signOut}>
            <Button type="submit" variant="ghost">
              Sign out
            </Button>
          </form>
        </div>
      </div>

      {projects.length === 0 && <p className="text-muted-foreground">No tools are set up yet.</p>}

      {projects.map((project) => {
        const code = codes.get(project.id)
        const live = code !== undefined && code.revokedAt === null
        return (
          <Card key={project.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                {project.name}
                {live && <Badge variant="secondary">Has a code</Badge>}
              </CardTitle>
              {project.description !== '' && (
                <CardDescription>{project.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">{codeStatus(code)}</p>
              <CodeButton projectId={project.id} hasCode={live} />
            </CardContent>
            {project.homepageUrl !== null && (
              <CardFooter>
                <a href={project.homepageUrl}>About {project.name}</a>
              </CardFooter>
            )}
          </Card>
        )
      })}
    </div>
  )
}
