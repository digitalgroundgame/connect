import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latestHindsightRelease } from '@/services/hindsight-release'

const download = 'https://github.com/digitalgroundgame/obs-hindsight/releases/download/0.9.0/'

function asset(name: string, size = 31_400_000, url = download + name) {
  return { name, browser_download_url: url, size }
}

function respond(body: unknown, status = 200) {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

describe('latestHindsightRelease', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('finds the Windows installer and zip in the latest release', async () => {
    respond({
      tag_name: 'v0.9.0',
      html_url: 'https://github.com/digitalgroundgame/obs-hindsight/releases/tag/v0.9.0',
      assets: [
        asset('obs-hindsight-0.9.0-macos-universal.pkg'),
        asset('obs-hindsight-0.9.0-windows-x64.zip', 30_060_000),
        asset('obs-hindsight-0.9.0-windows-x64-installer.exe'),
      ],
    })
    expect(await latestHindsightRelease()).toEqual({
      version: '0.9.0',
      pageUrl: 'https://github.com/digitalgroundgame/obs-hindsight/releases/tag/v0.9.0',
      installer: {
        name: 'obs-hindsight-0.9.0-windows-x64-installer.exe',
        url: download + 'obs-hindsight-0.9.0-windows-x64-installer.exe',
        sizeMb: 31.4,
      },
      zip: {
        name: 'obs-hindsight-0.9.0-windows-x64.zip',
        url: download + 'obs-hindsight-0.9.0-windows-x64.zip',
        sizeMb: 30.1,
      },
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/digitalgroundgame/obs-hindsight/releases/latest',
      expect.objectContaining({ next: { revalidate: 600 } }),
    )
  })

  it('links only files from the plugin’s own releases', async () => {
    respond({
      tag_name: '0.9.0',
      html_url: 'https://evil.test/release',
      assets: [
        asset('obs-hindsight-0.9.0-windows-x64-installer.exe', 1, 'https://evil.test/x.exe'),
      ],
    })
    expect(await latestHindsightRelease()).toMatchObject({
      pageUrl: 'https://github.com/digitalgroundgame/obs-hindsight/releases/latest',
      installer: null,
      zip: null,
    })
  })

  it('is null when GitHub fails or answers oddly', async () => {
    respond({ message: 'Not Found' }, 404)
    expect(await latestHindsightRelease()).toBeNull()
    respond({ tag_name: 1 })
    expect(await latestHindsightRelease()).toBeNull()
    vi.mocked(fetch).mockRejectedValue(new Error('timed out'))
    expect(await latestHindsightRelease()).toBeNull()
  })
})
