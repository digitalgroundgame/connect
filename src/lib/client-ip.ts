/**
 * Who a request comes from, for rate limits on failed codes. Only the header
 * named in CLIENT_IP_HEADER is trusted, and only because the deploy promises
 * the proxy in front of us sets it (Cloudflare sets CF-Connecting-IP and
 * overwrites any copy the visitor sends). With no header configured, every
 * visitor shares one key: stricter, never spoofable.
 */
export function clientKey(headers: Headers, headerName: string | null): string {
  if (headerName === null) return 'all'
  const value = headers.get(headerName)?.split(',')[0]?.trim()
  return value !== undefined && value !== '' ? value : 'unknown'
}
