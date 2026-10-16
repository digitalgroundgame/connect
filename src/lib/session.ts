import 'server-only'
import { headers } from 'next/headers'
import { getAuth } from './auth'

export interface Member {
  id: string
  name: string
  discordId: string
  discordUsername: string
  isAdmin: boolean
}

/** The signed-in member, or null. */
export async function currentMember(): Promise<Member | null> {
  // Read the request first: it marks the page as dynamic before any settings are needed.
  const requestHeaders = await headers()
  const session = await getAuth().api.getSession({ headers: requestHeaders })
  if (session === null) return null
  const { id, name, discordId, discordUsername } = session.user
  return {
    id,
    name,
    discordId,
    discordUsername,
    isAdmin: session.user.isAdmin === true,
  }
}
