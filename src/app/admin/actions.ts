'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { getDb } from '@/db'
import { isValidSlug } from '@/lib/codes'
import { log } from '@/lib/log'
import { currentMember, type Member } from '@/lib/session'
import { revokeCode } from '@/services/codes'
import { createProject, updateProject, type ProjectInput } from '@/services/projects'

export type FormState =
  { status: 'idle' } | { status: 'saved' } | { status: 'error'; message: string }

async function requireAdmin(): Promise<Member> {
  const member = await currentMember()
  if (member === null || !member.isAdmin) notFound()
  return member
}

function text(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

/** Reads the project fields, or says what is wrong with them. */
async function parseProjectForm(
  form: FormData,
): Promise<{ input: ProjectInput } | { error: string }> {
  const slug = text(form, 'slug').toLowerCase()
  const name = text(form, 'name')
  const description = text(form, 'description')
  const homepage = text(form, 'homepageUrl')
  if (name === '' || name.length > 80)
    return { error: 'Give the project a name up to 80 characters.' }
  if (description.length > 500) return { error: 'Keep the description under 500 characters.' }
  let homepageUrl: string | null = null
  if (homepage !== '') {
    let url: URL
    try {
      url = new URL(homepage)
    } catch {
      return { error: 'The homepage must be a full https:// link.' }
    }
    if (url.protocol !== 'https:') return { error: 'The homepage must be a full https:// link.' }
    homepageUrl = url.toString()
  }
  return {
    input: {
      slug,
      name,
      description,
      homepageUrl,
      canDm: form.get('canDm') === 'on',
      enabled: form.get('enabled') === 'on',
    },
  }
}

export async function saveProject(_previous: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  const parsed = await parseProjectForm(form)
  if ('error' in parsed) return { status: 'error', message: parsed.error }
  const db = getDb()
  const id = text(form, 'id')

  if (id === '') {
    if (!isValidSlug(parsed.input.slug)) {
      return {
        status: 'error',
        message: 'The slug is 1 to 32 lowercase letters, digits or dashes, like "hindsight".',
      }
    }
    try {
      await createProject(db, parsed.input)
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
        return { status: 'error', message: 'Another project already uses that slug.' }
      }
      throw error
    }
    log.info({ admin: admin.discordId, project: parsed.input.slug }, 'project created')
  } else {
    const { name, description, homepageUrl, canDm, enabled } = parsed.input
    const project = await updateProject(db, id, { name, description, homepageUrl, canDm, enabled })
    if (project === null) return { status: 'error', message: 'That project no longer exists.' }
    log.info({ admin: admin.discordId, project: project.slug }, 'project updated')
  }

  revalidatePath('/admin')
  return { status: 'saved' }
}

export async function revokeMemberCode(form: FormData): Promise<void> {
  const admin = await requireAdmin()
  const codeId = text(form, 'codeId')
  if (codeId !== '' && (await revokeCode(getDb(), codeId))) {
    log.info({ admin: admin.discordId, codeId }, 'code revoked')
  }
  revalidatePath('/admin')
}
