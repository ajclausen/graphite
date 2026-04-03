import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from './utils/theme'
import './index.css'
import App from './App.tsx'

initTheme();
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
