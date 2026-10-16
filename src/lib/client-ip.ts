/**
 * Who a request comes from, for rate limits on failed codes. Only the header
 * named in CLIENT_IP_HEADER is trusted, and only because the deploy promises
 * the proxy in front of us sets it (Cloudflare sets CF-Connecting-IP and
 * overwrites any copy the visitor sends). Null when there is no such IP: then
 * nothing is limited per source, because a shared bucket would let one bad
 * client lock every tool out. Codes are 256-bit, so guessing stays hopeless.
 */
export function clientKey(headers: Headers, headerName: string | null): string | null {
  if (headerName === null) return null
  return headers.get(headerName)?.split(',')[0]?.trim() || null
}
