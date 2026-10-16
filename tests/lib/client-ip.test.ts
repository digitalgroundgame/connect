import { describe, expect, it } from 'vitest'
import { clientKey } from '@/lib/client-ip'

describe('clientKey', () => {
  it('is "all" when no header is configured, whatever the request sends', () => {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })
    expect(clientKey(headers, null)).toBe('all')
  })

  it('reads the configured header', () => {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.7' })
    expect(clientKey(headers, 'CF-Connecting-IP')).toBe('203.0.113.7')
  })

  it('ignores headers other than the configured one', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4' })
    expect(clientKey(headers, 'CF-Connecting-IP')).toBe('unknown')
  })

  it('takes the first entry of a list and trims it', () => {
    const headers = new Headers({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' })
    expect(clientKey(headers, 'x-forwarded-for')).toBe('198.51.100.1')
  })

  it('is "unknown" when the header is missing', () => {
    expect(clientKey(new Headers(), 'cf-connecting-ip')).toBe('unknown')
  })

  it('is "unknown" when the header is blank', () => {
    const headers = new Headers({ 'cf-connecting-ip': '   ' })
    expect(clientKey(headers, 'cf-connecting-ip')).toBe('unknown')
  })

  it('is "unknown" when the first list entry is empty', () => {
    const headers = new Headers({ 'x-forwarded-for': ', 10.0.0.1' })
    expect(clientKey(headers, 'x-forwarded-for')).toBe('unknown')
  })
})
