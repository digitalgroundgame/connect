import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { currentMember } from '@/lib/session'
import { findProjectBySlug } from '@/services/projects'
import { ProjectForm } from '../../project-form'

// The page and its title both need the project; this looks it up once per request.
const projectAt = cache(findProjectBySlug)

/** Edits one project, such as /admin/projects/hindsight. */
export default async function EditProjectPage({ params }: PageProps<'/admin/projects/[slug]'>) {
  const member = await currentMember()
  if (member === null || !member.isAdmin) notFound()
  const project = await projectAt((await params).slug)
  if (project === null) notFound()

  return (
    <div className="space-y-4">
      <p>
        <Link href="/admin">All projects</Link>
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading text-2xl font-bold">
            {project.name}
            {!project.enabled && <Badge variant="outline">Off</Badge>}
            {project.canDm && <Badge variant="secondary">DMs</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectForm project={project} />
        </CardContent>
      </Card>
    </div>
  )
}

export async function generateMetadata({
  params,
}: PageProps<'/admin/projects/[slug]'>): Promise<Metadata> {
  const member = await currentMember()
  if (member === null || !member.isAdmin) return {}
  const project = await projectAt((await params).slug)
  return project === null ? {} : { title: `Edit ${project.name}` }
}
