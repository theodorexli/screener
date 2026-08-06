import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PredictionsPage } from './pages/PredictionsPage.tsx'
import { PostHogProvider } from 'posthog-js/react'

const options = {
  api_host: 'https://us.i.posthog.com',
  defaults: '2025-05-24',
} as const

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
const isPredictionsPage = pathname === '/predictions'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY} options={options}>
      {isPredictionsPage ? <PredictionsPage /> : <App />}
    </PostHogProvider>
  </StrictMode>,
)

