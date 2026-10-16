'use client'

import { useActionState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { Project } from '@/services/projects'
import { saveProject, type FormState } from './actions'

/** Creates a project, or edits one when given it. The slug is fixed once created. */
export function ProjectForm({ project }: { project?: Project }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProject, {
    status: 'idle',
  })
  const prefix = project?.id ?? 'new'

  return (
    <form action={action}>
      <input type="hidden" name="id" value={project?.id ?? ''} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${prefix}-slug`}>Slug</FieldLabel>
          <Input
            id={`${prefix}-slug`}
            name="slug"
            defaultValue={project?.slug}
            disabled={project !== undefined}
            required={project === undefined}
            placeholder="my-tool"
          />
          <FieldDescription>Fixed once created. Tools see it in API answers.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-name`}>Name</FieldLabel>
          <Input id={`${prefix}-name`} name="name" defaultValue={project?.name} required />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-description`}>Description</FieldLabel>
          <Textarea
            id={`${prefix}-description`}
            name="description"
            defaultValue={project?.description}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-homepage`}>Homepage</FieldLabel>
          <Input
            id={`${prefix}-homepage`}
            name="homepageUrl"
            type="url"
            defaultValue={project?.homepageUrl ?? ''}
            placeholder="https://"
          />
        </Field>
        <Field orientation="horizontal">
          <Switch id={`${prefix}-canDm`} name="canDm" defaultChecked={project?.canDm ?? false} />
          <FieldLabel htmlFor={`${prefix}-canDm`}>Can send Discord DMs to members</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id={`${prefix}-enabled`}
            name="enabled"
            defaultChecked={project?.enabled ?? true}
          />
          <FieldLabel htmlFor={`${prefix}-enabled`}>Enabled</FieldLabel>
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : project === undefined ? 'Add project' : 'Save'}
          </Button>
          {state.status === 'saved' && (
            <p role="status" className="text-muted-foreground">
              Saved.
            </p>
          )}
        </div>
        {state.status === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
      </FieldGroup>
    </form>
  )
}
