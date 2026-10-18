import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HINDSIGHT_RELEASES_PAGE, type HindsightRelease } from '@/services/hindsight-release'

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {n}. {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

const list = 'list-decimal space-y-2 pl-5'

/**
 * How to install and set up Hindsight, with the member's code as step 2. The
 * steps follow the obs-hindsight README; keep them in step when it changes.
 */
export function HindsightGuide({
  release,
  codeStep,
}: {
  release: HindsightRelease | null
  codeStep: ReactNode
}) {
  const installer = release?.installer ?? null
  const pageUrl = release?.pageUrl ?? HINDSIGHT_RELEASES_PAGE
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-bold">Hindsight</h1>
        <p>
          Ask a question out loud on stream, press a hotkey, and Hindsight sends Claude&apos;s
          answer to you as a Discord DM or to other destinations. It runs inside OBS 31.1 or newer
          on Windows, transcribes your mic on your own PC, and uses your own Claude API key.
        </p>
        <p className="text-muted-foreground">
          Discord DMs come from the Digital Ground Game bot, so stay in the Digital Ground Game
          Discord server with DMs from server members turned on. Each question and answer is also
          written to the OBS log (Help &gt; Log Files).
        </p>
      </div>

      <Step n={1} title="Install the plugin">
        <Button
          size="lg"
          className="h-11 px-5 text-base"
          nativeButton={false}
          render={<a href={installer?.url ?? pageUrl} />}
        >
          {installer === null || release === null
            ? 'Download for Windows'
            : `Download Hindsight ${release.version} for Windows (${installer.sizeMb} MB)`}
        </Button>
        <ol className={list}>
          <li>Close OBS.</li>
          <li>
            Open the installer. It isn&apos;t code-signed yet, so Windows warns you first. These
            warnings are expected for this file:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                If your browser holds the download back, choose <strong>Keep</strong> (in Edge, then{' '}
                <strong>Show more</strong> and <strong>Keep anyway</strong>).
              </li>
              <li>
                On &quot;Windows protected your PC&quot;, click <strong>More info</strong>, then{' '}
                <strong>Run anyway</strong>.
              </li>
              <li>
                When Windows asks to allow changes, click <strong>Yes</strong>.
              </li>
            </ul>
          </li>
          <li>
            Click <strong>Install</strong>, then start OBS.
          </li>
        </ol>
        <p className="text-sm text-muted-foreground">
          Transcription needs a CPU from about 2015 or newer (one with AVX2).{' '}
          {release?.zip != null && (
            <>
              Rather not run an installer? Download the <a href={release.zip.url}>zip</a>, close
              OBS, and move its <code>obs-hindsight</code> folder into{' '}
              <code>C:\ProgramData\obs-studio\plugins\</code>.{' '}
            </>
          )}
          Checksums and every file are on the <a href={pageUrl}>GitHub release page</a>.
        </p>
      </Step>

      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">2. Get your Hindsight code</h2>
        {codeStep}
      </div>

      <Step n={3} title="Set it up in OBS">
        <ol className={list}>
          <li>
            The first time OBS starts with Hindsight, it downloads its speech model (about 142 MB).{' '}
            <strong>Tools &gt; Hindsight settings</strong> shows the progress.
          </li>
          <li>
            In <strong>Tools &gt; Hindsight settings</strong>, paste your Claude API key and your
            Hindsight code, then click <strong>Save</strong>. Create the key on the{' '}
            <a href="https://platform.claude.com/settings/keys">API keys</a> page of the Claude
            Console with a workspace selected. Keep web search on under{' '}
            <a href="https://platform.claude.com/settings/capabilities">Capabilities</a>; Hindsight
            uses up to three searches a question, at $0.01 each.
          </li>
          <li>
            Click <strong>Test</strong> beside your Hindsight code. The Digital Ground Game bot
            sends you a test DM on Discord.
          </li>
          <li>
            Open your mic&apos;s <strong>Filters</strong> and add <strong>Hindsight</strong>.
          </li>
          <li>
            In <strong>Settings &gt; Hotkeys</strong>, find your mic and bind &quot;Hindsight:
            answer the last question&quot;.
          </li>
          <li>Ask a question out loud, then press the hotkey. The answer arrives as a DM.</li>
        </ol>
        <p className="text-sm text-muted-foreground">
          When a new version is out, the Hindsight filter&apos;s settings show an{' '}
          <strong>Update now</strong> button. To uninstall, use Windows{' '}
          <strong>Settings &gt; Apps &gt; Installed apps</strong>.
        </p>
      </Step>
    </div>
  )
}
