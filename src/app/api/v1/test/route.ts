import { dmApi } from '@/api/instance'

export function POST(request: Request): Promise<Response> {
  return dmApi().test(request)
}
