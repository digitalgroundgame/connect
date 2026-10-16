import { messageNonce } from '@/lib/codes'
import { authenticate, errorResponse, guarded, readMessage, send, withFooter } from '@/lib/dm'
import { takeMessage } from '@/lib/rate-limits'

/** Sends the tool's text to its member, with a footer naming the tool. */
export function POST(req: Request): Promise<Response> {
  return guarded(async () => {
    // The code is checked before the body is read, so a caller without one
    // learns only that, and costs no parsing.
    const owner = await authenticate(req)
    if (owner instanceof Response) return owner
    const input = await readMessage(req)
    if (typeof input === 'string') return errorResponse(input)
    const nonce = input.id && messageNonce(owner.codeId, input.id, input.content)
    const limit = await takeMessage(owner.codeId)
    return send(owner, limit, withFooter(input.content, owner.project.name), nonce, 'message')
  })
}
