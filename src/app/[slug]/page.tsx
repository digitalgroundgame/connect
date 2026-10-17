import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { currentMember } from '@/lib/session'
import { codesForUser } from '@/services/codes'
import { findEnabledProjectBySlug } from '@/services/projects'
import { MemberBar } from '../member-bar'
import { ProjectCard } from '../project-card'
import { SignInCard } from '../sign-in-card'

// The page and its title both need the project; this looks it up once per request.
const projectAt = cache(findEnabledProjectBySlug)

/** One tool's page, such as /hindsight: the link to share with people who use it. */
export default async function ProjectPage({ params, searchParams }: PageProps<'/[slug]'>) {
  const project = await projectAt((await params).slug)
  if (project === null) notFound()

  const member = await currentMember()
  if (member === null) {
    return (
      <SignInCard
        title={`Get a code for ${project.name}`}
        description={
          project.description === ''
            ? 'Sign in with Discord to get your code. You need to be in the DGG Discord server.'
            : `${project.description} Sign in with Discord to get your code. You need to be in the DGG Discord server.`
        }
        error={(await searchParams).error}
        returnTo={`/${project.slug}`}
      />
    )
  }

  const codes = await codesForUser(member.id)
  return (
    <div className="space-y-6">
      <MemberBar member={member} />
      <ProjectCard project={project} code={codes.get(project.id)} />
      <p>
        <Link href="/">All DGG tools</Link>
      </p>
    </div>
  )
}

export async function generateMetadata({ params }: PageProps<'/[slug]'>): Promise<Metadata> {
  const project = await projectAt((await params).slug)
  return project === null ? {} : { title: project.name }
}
