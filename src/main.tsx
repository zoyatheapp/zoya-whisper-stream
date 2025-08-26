import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ensureWebRTCGlobals } from '@/lib/webrtc'

ensureWebRTCGlobals();
createRoot(document.getElementById('root')!).render(<App />);
