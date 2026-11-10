// Entry point of the game (index.html). The M1 debug page lives at debug.html.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { boot } from './game/controller'
import { bootCampaign } from './campaign/controller'
import { installHook } from './hook'
import './style.css'

// Rule 24: no text selection, callouts or context menus on a long press, except in editable fields.
const editable = (t: EventTarget | null): boolean => t instanceof HTMLElement && /^(input|textarea|select)$/i.test(t.tagName) || (t instanceof HTMLElement && t.isContentEditable)
document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault() })
document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault() })

// iPhone and iPad: the home bar at the bottom edge takes swipes for app switching, and inside the claude.ai frame the browser may
// report no safe area, so the bottom bars keep a minimum gap there (style.css, html.ios).
const ua = navigator.userAgent
if (/iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) document.documentElement.classList.add('ios')

boot()
bootCampaign()
installHook()
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
