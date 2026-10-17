import { currentMember } from '@/lib/session'
import { codesForUser } from '@/services/codes'
import { listEnabledProjects } from '@/services/projects'
import { MemberBar } from './member-bar'
import { ProjectCard } from './project-card'
import { SignInCard } from './sign-in-card'

export default async function Home({ searchParams }: PageProps<'/'>) {
  const member = await currentMember()

  if (member === null) {
    return (
      <SignInCard
        title="Codes for DGG tools"
        description="Sign in with Discord to get a code for each Digital Ground Game tool you use, like the Hindsight OBS plugin. You need to be in the DGG Discord server."
        error={(await searchParams).error}
        returnTo="/"
      />
    )
  }

  const [projects, codes] = await Promise.all([listEnabledProjects(), codesForUser(member.id)])

  return (
    <div className="space-y-6">
      <MemberBar member={member} />

      {projects.length === 0 && <p className="text-muted-foreground">No tools are set up yet.</p>}

      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} code={codes.get(project.id)} />
      ))}
    </div>
  )
}
