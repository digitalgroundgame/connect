import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { currentMember } from '@/lib/session'
import { listMembers } from '@/services/codes'
import { listProjects } from '@/services/projects'
import { revokeMemberCode, setMemberAdmin } from './actions'
import { ProjectForm } from './project-form'

export const metadata: Metadata = { title: 'Admin' }

function day(date: Date | null): string {
  return date === null ? 'never' : date.toISOString().slice(0, 10)
}

export default async function AdminPage() {
  const member = await currentMember()
  if (member === null || !member.isAdmin) notFound()

  const [projects, members] = await Promise.all([listProjects(), listMembers()])

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="font-heading text-2xl font-bold">Projects</h1>
        {projects.map((project) => (
          <Card key={project.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                {project.name}
                {!project.enabled && <Badge variant="outline">Off</Badge>}
                {project.canDm && <Badge variant="secondary">DMs</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectForm project={project} />
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add a project</CardTitle>
            <CardDescription>
              Members can get a code for it as soon as it is enabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectForm />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl font-bold">Members</h2>
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.flatMap((m) =>
                  (m.codes.length === 0 ? [null] : m.codes).map((code, i) => (
                    <TableRow key={code?.id ?? m.id}>
                      <TableCell>
                        {i === 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              {m.discordUsername}
                              {m.role === 'admin' && <Badge variant="secondary">Admin</Badge>}
                            </div>
                            <span className="block text-muted-foreground">{m.discordId}</span>
                            {m.id !== member.id && (
                              <form action={setMemberAdmin}>
                                <input type="hidden" name="userId" value={m.id} />
                                <input
                                  type="hidden"
                                  name="admin"
                                  value={String(!(m.role === 'admin'))}
                                />
                                <Button type="submit" variant="link" size="xs" className="px-0">
                                  {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                                </Button>
                              </form>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{code?.projectName ?? 'No codes'}</TableCell>
                      <TableCell>{code ? day(code.issuedAt) : ''}</TableCell>
                      <TableCell>{code ? day(code.lastUsedAt) : ''}</TableCell>
                      <TableCell className="text-right">
                        {code && code.revokedAt === null && (
                          <form action={revokeMemberCode}>
                            <input type="hidden" name="codeId" value={code.id} />
                            <Button type="submit" variant="destructive" size="sm">
                              Turn off
                            </Button>
                          </form>
                        )}
                        {code?.revokedAt && <Badge variant="outline">Off</Badge>}
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
