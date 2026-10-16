import { describe, expect, it } from 'vitest'
import {
  codeFromHeader,
  hashCode,
  isValidSlug,
  looksLikeCode,
  messageNonce,
  newCode,
} from '@/lib/codes'

describe('newCode', () => {
  it('is dgc_ followed by 43 base64url characters', () => {
    expect(newCode()).toMatch(/^dgc_[A-Za-z0-9_-]{43}$/)
  })

  it('passes looksLikeCode', () => {
    expect(looksLikeCode(newCode())).toBe(true)
  })

  it('never repeats', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => newCode()))
    expect(codes.size).toBe(1000)
  })
})

describe('hashCode', () => {
  it('is the hex SHA-256 of the code', () => {
    expect(hashCode('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('is stable for the same code', () => {
    const code = newCode()
    expect(hashCode(code)).toBe(hashCode(code))
  })

  it('differs between codes', () => {
    expect(hashCode(newCode())).not.toBe(hashCode(newCode()))
  })
})

describe('looksLikeCode', () => {
  const body = 'a'.repeat(43)

  it('accepts the prefix and 43 base64url characters', () => {
    expect(looksLikeCode(`dgc_${body}`)).toBe(true)
    expect(looksLikeCode(`dgc_${'-_aZ09'.repeat(7)}x`)).toBe(true)
  })

  it('rejects the wrong length', () => {
    expect(looksLikeCode(`dgc_${'a'.repeat(42)}`)).toBe(false)
    expect(looksLikeCode(`dgc_${'a'.repeat(44)}`)).toBe(false)
  })

  it('rejects a missing or different prefix', () => {
    expect(looksLikeCode(body)).toBe(false)
    expect(looksLikeCode(`DGC_${body}`)).toBe(false)
    expect(looksLikeCode(`xyz_${body}`)).toBe(false)
  })

  it('rejects characters outside base64url', () => {
    expect(looksLikeCode(`dgc_${'a'.repeat(42)}+`)).toBe(false)
    expect(looksLikeCode(`dgc_${'a'.repeat(42)}=`)).toBe(false)
    expect(looksLikeCode(`dgc_${'a'.repeat(42)} `)).toBe(false)
  })

  it('rejects the empty string', () => {
    expect(looksLikeCode('')).toBe(false)
  })
})

describe('codeFromHeader', () => {
  const code = newCode()

  it('reads a Bearer code', () => {
    expect(codeFromHeader(`Bearer ${code}`)).toBe(code)
  })

  it('accepts any case of Bearer and extra spaces after it', () => {
    expect(codeFromHeader(`bearer ${code}`)).toBe(code)
    expect(codeFromHeader(`BEARER   ${code}`)).toBe(code)
  })

  it('returns null for a missing header', () => {
    expect(codeFromHeader(null)).toBeNull()
    expect(codeFromHeader('')).toBeNull()
  })

  it('returns null for another scheme', () => {
    expect(codeFromHeader(`Basic ${code}`)).toBeNull()
    expect(codeFromHeader(`Bot ${code}`)).toBeNull()
  })

  it('returns null for a bare code with no scheme', () => {
    expect(codeFromHeader(code)).toBeNull()
  })

  it('returns null when the token is not a code', () => {
    expect(codeFromHeader('Bearer abc')).toBeNull()
    expect(codeFromHeader('Bearer ')).toBeNull()
    expect(codeFromHeader('Bearer')).toBeNull()
  })

  it('returns null for trailing junk after the code', () => {
    expect(codeFromHeader(`Bearer ${code} extra`)).toBeNull()
    expect(codeFromHeader(`Bearer ${code}x`)).toBeNull()
  })
})

describe('messageNonce', () => {
  it('is 25 base64url characters', () => {
    expect(messageNonce('code-1', 'msg-1', 'hello')).toMatch(/^[A-Za-z0-9_-]{25}$/)
  })

  it('is the same for the same inputs', () => {
    expect(messageNonce('code-1', 'msg-1', 'hello')).toBe(messageNonce('code-1', 'msg-1', 'hello'))
  })

  it('changes with the code', () => {
    expect(messageNonce('code-1', 'msg-1', 'hello')).not.toBe(
      messageNonce('code-2', 'msg-1', 'hello'),
    )
  })

  it('changes with the message id', () => {
    expect(messageNonce('code-1', 'msg-1', 'hello')).not.toBe(
      messageNonce('code-1', 'msg-2', 'hello'),
    )
  })

  it('changes with the content', () => {
    expect(messageNonce('code-1', 'msg-1', 'hello')).not.toBe(
      messageNonce('code-1', 'msg-1', 'hello!'),
    )
  })

  it('keeps fields apart, so shifting text between them changes the nonce', () => {
    expect(messageNonce('ab', 'c', 'd')).not.toBe(messageNonce('a', 'bc', 'd'))
  })
})

describe('isValidSlug', () => {
  it('accepts lowercase letters, digits and inner hyphens', () => {
    expect(isValidSlug('hindsight')).toBe(true)
    expect(isValidSlug('tool-2')).toBe(true)
    expect(isValidSlug('a-b-c')).toBe(true)
  })

  it('accepts a single character', () => {
    expect(isValidSlug('a')).toBe(true)
    expect(isValidSlug('7')).toBe(true)
  })

  it('accepts up to 32 characters and no more', () => {
    expect(isValidSlug('a'.repeat(32))).toBe(true)
    expect(isValidSlug('a'.repeat(33))).toBe(false)
  })

  it('rejects the empty string', () => {
    expect(isValidSlug('')).toBe(false)
  })

  it('rejects a leading or trailing hyphen', () => {
    expect(isValidSlug('-tool')).toBe(false)
    expect(isValidSlug('tool-')).toBe(false)
    expect(isValidSlug('-')).toBe(false)
  })

  it('rejects uppercase, spaces, underscores and other symbols', () => {
    expect(isValidSlug('Tool')).toBe(false)
    expect(isValidSlug('my tool')).toBe(false)
    expect(isValidSlug('my_tool')).toBe(false)
    expect(isValidSlug('tool.io')).toBe(false)
    expect(isValidSlug('tool/x')).toBe(false)
  })

  it('rejects a trailing newline', () => {
    expect(isValidSlug('tool\n')).toBe(false)
  })
})
