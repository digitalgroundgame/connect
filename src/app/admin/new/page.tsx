import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { currentMember } from '@/lib/session'
import { ProjectForm } from '../project-form'

export const metadata: Metadata = { title: 'Add a project' }

export default async function NewProjectPage() {
  const member = await currentMember()
  if (member === null || !member.isAdmin) notFound()

  return (
    <div className="space-y-4">
      <p>
        <Link href="/admin">All projects</Link>
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl font-bold">Add a project</CardTitle>
          <CardDescription>Members can get a code for it as soon as it is enabled.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm />
        </CardContent>
      </Card>
    </div>
  )
}
