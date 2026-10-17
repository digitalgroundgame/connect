import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Member } from '@/lib/session'
import { signOut } from './actions'

/** Who is signed in, with Admin and Sign out. */
export function MemberBar({ member }: { member: Member }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p>
        Signed in as <strong>{member.discordUsername}</strong>.
      </p>
      <div className="flex items-center gap-2">
        {member.isAdmin && (
          <Button variant="outline" nativeButton={false} render={<Link href="/admin" />}>
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
  )
}
