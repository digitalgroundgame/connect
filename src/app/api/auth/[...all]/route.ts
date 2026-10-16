import { getAuth } from '@/lib/auth'

// Better Auth's own endpoints: Discord sign-in, its callback, sign-out.
export function GET(request: Request): Promise<Response> {
  return getAuth().handler(request)
}

export function POST(request: Request): Promise<Response> {
  return getAuth().handler(request)
}
