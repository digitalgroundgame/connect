import { describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/health/route'
import { db } from '@/db'

vi.mock('@/db', () => ({ db: { execute: vi.fn() } }))

describe('GET /api/health', () => {
  it('is up when Postgres answers', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({} as never)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('is down when Postgres does not', async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false })
  })
})
