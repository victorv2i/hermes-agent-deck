import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { router } from '@/app/router'
import { queryClient } from '@/lib/queryClient'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { TranslationProvider } from '@/i18n'
import { ErrorBoundary } from '@/components/system/ErrorBoundary'
import { registerNotificationServiceWorker } from '@/lib/swNotify'

// Register the notification service worker in production only (the built /sw.js
// is served from the dist root). It self-gates to secure contexts (HTTPS /
// localhost) and never throws; on success the in-tab notifier routes run notices
// through it so a backgrounded tab still gets pinged.
if (import.meta.env.PROD) {
  void registerNotificationServiceWorker()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TranslationProvider>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </TranslationProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
