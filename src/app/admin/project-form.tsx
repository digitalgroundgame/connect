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
  // What the admin last submitted, if it was refused; otherwise the saved project.
  const values = state.status === 'error' ? state.values : undefined
  const checked = (field: 'canDm' | 'enabled', saved: boolean) =>
    values === undefined ? saved : values[field] === 'on'

  return (
    <form action={action}>
      <input type="hidden" name="id" value={project?.id ?? ''} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${prefix}-slug`}>Slug</FieldLabel>
          <Input
            id={`${prefix}-slug`}
            name="slug"
            defaultValue={values?.slug ?? project?.slug}
            disabled={project !== undefined}
            required={project === undefined}
            placeholder="my-tool"
          />
          <FieldDescription>Fixed once created. Tools see it in API answers.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-name`}>Name</FieldLabel>
          <Input
            id={`${prefix}-name`}
            name="name"
            defaultValue={values?.name ?? project?.name}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-description`}>Description</FieldLabel>
          <Textarea
            id={`${prefix}-description`}
            name="description"
            defaultValue={values?.description ?? project?.description}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-homepage`}>Homepage</FieldLabel>
          <Input
            id={`${prefix}-homepage`}
            name="homepageUrl"
            type="url"
            defaultValue={values?.homepageUrl ?? project?.homepageUrl ?? ''}
            placeholder="https://"
          />
        </Field>
        <Field orientation="horizontal">
          <Switch
            id={`${prefix}-canDm`}
            name="canDm"
            defaultChecked={checked('canDm', project?.canDm ?? false)}
          />
          <FieldLabel htmlFor={`${prefix}-canDm`}>Can send Discord DMs to members</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id={`${prefix}-enabled`}
            name="enabled"
            defaultChecked={checked('enabled', project?.enabled ?? true)}
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
