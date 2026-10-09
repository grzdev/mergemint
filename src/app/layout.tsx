import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://mergemiint.netlify.app'),
  title: 'MergeMint — Fund the next contribution',
  description: 'GitHub-native bounties. Clear work, deliberate approvals, Canton settlement.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png', sizes: '32x32' },
      { url: '/logo.png', type: 'image/png', sizes: '512x512' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'MergeMint — Fund the next contribution',
    description: 'GitHub-native bounties. Clear work, deliberate approvals, Canton settlement.',
    url: 'https://mergemiint.netlify.app',
    siteName: 'MergeMint',
    images: [
      {
        url: '/logo-banner.png',
        width: 1200,
        height: 630,
        alt: 'MergeMint — GitHub-native bounties with Canton settlement',
      },
      {
        url: '/logo.png',
        width: 512,
        height: 512,
        alt: 'MergeMint Brand Mark',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MergeMint — Fund the next contribution',
    description: 'GitHub-native bounties. Clear work, deliberate approvals, Canton settlement.',
    images: ['/logo-banner.png'],
  },
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
