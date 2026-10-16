import { describe, expect, it } from 'vitest'
import { clientKey } from '@/lib/client-ip'

describe('clientKey', () => {
  it('is null when no header is configured, whatever the request sends', () => {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })
    expect(clientKey(headers, null)).toBeNull()
  })

  it('reads the configured header', () => {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.7' })
    expect(clientKey(headers, 'CF-Connecting-IP')).toBe('203.0.113.7')
  })

  it('ignores headers other than the configured one', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4' })
    expect(clientKey(headers, 'CF-Connecting-IP')).toBeNull()
  })

  it('takes the first entry of a list and trims it', () => {
    const headers = new Headers({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' })
    expect(clientKey(headers, 'x-forwarded-for')).toBe('198.51.100.1')
  })

  it('is null when the header is missing', () => {
    expect(clientKey(new Headers(), 'cf-connecting-ip')).toBeNull()
  })

  it('is null when the header is blank', () => {
    const headers = new Headers({ 'cf-connecting-ip': '   ' })
    expect(clientKey(headers, 'cf-connecting-ip')).toBeNull()
  })

  it('is null when the first list entry is empty', () => {
    const headers = new Headers({ 'x-forwarded-for': ', 10.0.0.1' })
    expect(clientKey(headers, 'x-forwarded-for')).toBeNull()
  })
})
