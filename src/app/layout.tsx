import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'DGG Connect', template: '%s · DGG Connect' },
  description:
    'Sign in with Discord to get access codes for Digital Ground Game tools, like the Hindsight OBS plugin.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="mx-auto flex max-w-2xl items-center justify-between px-4 pt-6">
          <Link
            href="/"
            data-slot="brand"
            className="flex items-center gap-3 font-heading text-lg font-bold"
          >
            <Image src="/dgg-logo.png" alt="" width={40} height={40} className="rounded-lg" />
            DGG Connect
          </Link>
        </header>
        <main className="mx-auto max-w-2xl px-4 pt-6 pb-12">{children}</main>
        <footer className="mx-auto max-w-2xl px-4 pb-10 text-sm text-muted-foreground">
          Made by <a href="https://digitalgroundgame.org">Digital Ground Game</a>.
        </footer>
      </body>
    </html>
  )
}
