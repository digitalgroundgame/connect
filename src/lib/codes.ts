import { createHash, randomBytes } from 'node:crypto'

/**
 * Access codes: the secret a tool sends to act for one member in one project.
 * Only the SHA-256 of a code is stored, so a database leak gives out no
 * working codes. 32 random bytes make guessing hopeless, which is why a plain
 * hash (rather than a slow password hash) is enough.
 */
const PREFIX = 'dgc_'

export function newCode(): string {
  return PREFIX + randomBytes(32).toString('base64url')
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Rejects obvious junk before it costs a database lookup. */
export function looksLikeCode(value: string): boolean {
  return /^dgc_[A-Za-z0-9_-]{43}$/.test(value)
}

/** The code from `Authorization: Bearer <code>`, or null. */
export function codeFromHeader(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  return match !== null && looksLikeCode(match[1] as string) ? (match[1] as string) : null
}

/**
 * A Discord message nonce for one message: the same tool sending the same
 * text with the same message ID gets the same nonce, so a retry after a
 * timeout is not delivered twice. Discord allows up to 25 characters.
 */
export function messageNonce(codeId: string, messageId: string, content: string): string {
  return createHash('sha256')
    .update(`${codeId}\0${messageId}\0${content}`)
    .digest('base64url')
    .slice(0, 25)
}
