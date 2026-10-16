'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import { z } from 'zod'
import { isGuildMember } from '@/lib/discord'
import { currentMember } from '@/lib/session'
import { issueCode } from '@/services/codes'
import { findProject } from '@/services/projects'

export async function signIn(): Promise<void> {
  const result = await getAuth().api.signInSocial({
    body: { provider: 'discord', callbackURL: '/', errorCallbackURL: '/' },
  })
  if (result.url === undefined) redirect('/')
  redirect(result.url)
}

export async function signOut(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() })
  redirect('/')
}

export type CodeState =
  { status: 'idle' } | { status: 'issued'; code: string } | { status: 'error'; message: string }

/** Gives the member a new code for a project. The code is shown once. */
export async function getCode(_previous: CodeState, form: FormData): Promise<CodeState> {
  const member = await currentMember()
  if (member === null) redirect('/')
  const projectId = z.uuid().safeParse(form.get('projectId'))
  const project = projectId.success ? await findProject(projectId.data) : null
  if (project === null || !project.enabled) {
    return { status: 'error', message: 'That tool is not available right now.' }
  }
  // The session can outlive membership: someone who left or was banned from
  // the server gets no new codes.
  if (!(await isGuildMember(member.discordId))) {
    return {
      status: 'error',
      message: 'Your Discord account is no longer in the DGG Discord server.',
    }
  }
  const code = await issueCode(member.id, project.id)
  console.info('code issued', { userId: member.id, project: project.slug })
  revalidatePath('/')
  return { status: 'issued', code }
}
