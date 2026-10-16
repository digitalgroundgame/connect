'use client'

import { useActionState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getCode, type CodeState } from './actions'

/** Gets a code and shows it once, in place. */
export function CodeButton({ projectId, hasCode }: { projectId: string; hasCode: boolean }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(getCode, {
    status: 'idle',
  })

  if (state.status === 'issued') {
    return (
      <div className="space-y-2">
        <p>Copy this code into the tool now. It is shown only once.</p>
        <code className="block rounded-lg border border-dashed bg-muted p-3 font-mono text-base break-all select-all">
          {state.code}
        </code>
        <p className="text-muted-foreground">
          It works like a password: keep it off stream. Getting a new code turns this one off.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Getting a code…' : hasCode ? 'Get a new code' : 'Get a code'}
      </Button>
      {state.status === 'error' && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}
