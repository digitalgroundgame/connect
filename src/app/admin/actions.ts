'use server'

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { currentMember, type Member } from '@/lib/session'
import { revokeCode, setRole } from '@/services/codes'
import { createProject, updateProject } from '@/services/projects'

/**
 * On an error the submitted values come back, because React resets the form
 * after an action and would otherwise wipe what the admin typed.
 */
export type FormState =
  | { status: 'idle' }
  | { status: 'saved' }
  | { status: 'error'; message: string; values: Record<string, string> }

// Server actions are public endpoints: each one checks for an admin itself.
async function requireAdmin(): Promise<Member> {
  const member = await currentMember()
  if (member === null || !member.isAdmin) notFound()
  return member
}

const projectSchema = z.object({
  name: z.string().trim().min(1).max(80, 'Give the project a name up to 80 characters.'),
  description: z.string().trim().max(500, 'Keep the description under 500 characters.'),
  homepageUrl: z
    .union([
      z.literal(''),
      z.url({ protocol: /^https$/, error: 'The homepage must be a full https:// link.' }),
    ])
    .transform((url) => url || null),
  canDm: z.literal('on').optional().transform(Boolean),
  enabled: z.literal('on').optional().transform(Boolean),
})

const RESERVED_SLUGS = new Set(['admin', 'api'])

const newProjectSchema = projectSchema.extend({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/,
      'The slug is 1 to 32 lowercase letters, digits or dashes, like "hindsight".',
    )
    // The project's page is /<slug>, so it can't share a path with the site's own pages.
    .refine((slug) => !RESERVED_SLUGS.has(slug), 'That slug is taken by a page on this site.'),
})

/** Unset fields (an unchecked switch) are missing from the form, not empty. */
function fields(form: FormData): Record<string, string> {
  const out: Record<string, string> = { description: '', homepageUrl: '' }
  for (const [key, value] of form) if (typeof value === 'string') out[key] = value
  return out
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { cause?: { code?: string } }).cause?.code === '23505'
}

export async function saveProject(_previous: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  const id = form.get('id')

  if (typeof id === 'string' && id !== '') {
    if (!z.uuid().safeParse(id).success) {
      return { status: 'error', message: 'That project no longer exists.', values: fields(form) }
    }
    const parsed = projectSchema.safeParse(fields(form))
    if (!parsed.success)
      return { status: 'error', message: parsed.error.issues[0]!.message, values: fields(form) }
    // The slug is not in the update: it stays fixed once created.
    const project = await updateProject(id, parsed.data)
    if (project === null)
      return { status: 'error', message: 'That project no longer exists.', values: fields(form) }
    console.info('project updated', { admin: admin.discordId, project: project.slug })
  } else {
    const parsed = newProjectSchema.safeParse(fields(form))
    if (!parsed.success)
      return { status: 'error', message: parsed.error.issues[0]!.message, values: fields(form) }
    try {
      await createProject(parsed.data)
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          status: 'error',
          message: 'Another project already uses that slug.',
          values: fields(form),
        }
      }
      throw err
    }
    console.info('project created', { admin: admin.discordId, project: parsed.data.slug })
    revalidatePath('/admin', 'layout')
    // Back to the list, where the new project now shows.
    redirect('/admin')
  }

  revalidatePath('/admin', 'layout')
  return { status: 'saved' }
}

export async function revokeMemberCode(form: FormData): Promise<void> {
  const admin = await requireAdmin()
  const codeId = z.uuid().safeParse(form.get('codeId'))
  if (codeId.success && (await revokeCode(codeId.data))) {
    console.info('code revoked', { admin: admin.discordId, codeId: codeId.data })
  }
  revalidatePath('/admin')
}

export async function setMemberAdmin(form: FormData): Promise<void> {
  const admin = await requireAdmin()
  const userId = form.get('userId')
  const makeAdmin = form.get('admin') === 'true'
  // Admins cannot remove themselves; setRole also refuses to remove the last one.
  if (typeof userId !== 'string' || (userId === admin.id && !makeAdmin)) return
  if (await setRole(userId, makeAdmin ? 'admin' : 'user')) {
    console.info('admin role changed', { admin: admin.discordId, userId, isAdmin: makeAdmin })
  }
  revalidatePath('/admin')
}
