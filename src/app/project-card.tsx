import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { CodeInfo } from '@/services/codes'
import type { Project } from '@/services/projects'
import { CodeButton } from './code-button'

function codeStatus(code: CodeInfo | undefined): string {
  if (code === undefined) return 'No code yet.'
  if (code.revokedAt !== null) return 'Your code was turned off. Get a new one to keep using it.'
  if (code.lastUsedAt !== null) return `Code last used ${code.lastUsedAt.toUTCString()}.`
  return `Code issued ${code.issuedAt.toUTCString()}, not used yet.`
}

/** A tool, the member's code for it, and the button to get one. */
export function ProjectCard({ project, code }: { project: Project; code: CodeInfo | undefined }) {
  const live = code !== undefined && code.revokedAt === null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {project.name}
          {live && <Badge variant="secondary">Has a code</Badge>}
        </CardTitle>
        {project.description !== '' && <CardDescription>{project.description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">{codeStatus(code)}</p>
        <CodeButton projectId={project.id} hasCode={live} />
      </CardContent>
      {project.homepageUrl !== null && (
        <CardFooter>
          <a href={project.homepageUrl}>About {project.name}</a>
        </CardFooter>
      )}
    </Card>
  )
}
