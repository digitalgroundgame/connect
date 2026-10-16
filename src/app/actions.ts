'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDb } from '@/db'
import { getAuth } from '@/lib/auth'
import { log } from '@/lib/log'
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
  const projectId = form.get('projectId')
  const db = getDb()
  const project = typeof projectId === 'string' ? await findProject(db, projectId) : null
  if (project === null || !project.enabled) {
    return { status: 'error', message: 'That tool is not available right now.' }
  }
  const code = await issueCode(db, member.id, project.id)
  log.info({ userId: member.id, project: project.slug }, 'code issued')
  revalidatePath('/')
  return { status: 'issued', code }
}
