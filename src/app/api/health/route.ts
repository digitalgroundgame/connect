import { sql } from 'drizzle-orm'
import { db } from '@/db'

/** For the container HEALTHCHECK: up when the server answers and Postgres does too. */
export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
