import { z } from 'zod'

const LATEST_RELEASE_API =
  'https://api.github.com/repos/digitalgroundgame/obs-hindsight/releases/latest'
export const HINDSIGHT_RELEASES_PAGE =
  'https://github.com/digitalgroundgame/obs-hindsight/releases/latest'
// Only files GitHub serves from the plugin's own releases are linked.
const DOWNLOAD_PREFIX = 'https://github.com/digitalgroundgame/obs-hindsight/releases/download/'

export interface ReleaseFile {
  name: string
  url: string
  sizeMb: number
}

export interface HindsightRelease {
  version: string
  pageUrl: string
  installer: ReleaseFile | null
  zip: ReleaseFile | null
}

const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  assets: z.array(
    z.object({ name: z.string(), browser_download_url: z.string(), size: z.number() }),
  ),
})

function pick(assets: z.infer<typeof releaseSchema>['assets'], ending: RegExp): ReleaseFile | null {
  const asset = assets.find(
    (a) => ending.test(a.name) && a.browser_download_url.startsWith(DOWNLOAD_PREFIX),
  )
  if (asset === undefined) return null
  return {
    name: asset.name,
    url: asset.browser_download_url,
    sizeMb: Math.round(asset.size / 1e5) / 10,
  }
}

/**
 * The latest Hindsight release on GitHub, or null when GitHub can't say, so the
 * page falls back to linking the releases page. Next caches the answer for ten
 * minutes, which keeps us far under GitHub's 60 requests an hour.
 */
export async function latestHindsightRelease(): Promise<HindsightRelease | null> {
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dgg-connect' },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      console.error('hindsight release lookup failed', { status: res.status })
      return null
    }
    const release = releaseSchema.parse(await res.json())
    return {
      version: release.tag_name.replace(/^v/, ''),
      pageUrl: release.html_url.startsWith('https://github.com/digitalgroundgame/obs-hindsight/')
        ? release.html_url
        : HINDSIGHT_RELEASES_PAGE,
      installer: pick(release.assets, /-windows-x64-installer\.exe$/),
      zip: pick(release.assets, /-windows-x64\.zip$/),
    }
  } catch (err) {
    console.error('hindsight release lookup failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
