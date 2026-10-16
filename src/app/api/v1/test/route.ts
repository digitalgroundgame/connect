import { authenticate, guarded, send, testMessage } from '@/lib/dm'
import { takeTest } from '@/lib/rate-limits'

/** Sends a fixed test DM, so the member can check the whole path. */
export function POST(req: Request): Promise<Response> {
  return guarded(async () => {
    const owner = await authenticate(req)
    if (owner instanceof Response) return owner
    // No nonce: pressing Test twice should show two DMs.
    const limit = await takeTest(owner.codeId)
    return send(owner, limit, testMessage(owner.project.name), undefined, 'test')
  })
}
