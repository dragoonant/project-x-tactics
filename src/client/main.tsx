// Entry point of the game (index.html). The M1 debug page lives at debug.html.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { boot } from './game/controller'
import { installHook } from './hook'
import './style.css'

// Rule 24: no text selection, callouts or context menus on a long press, except in editable fields.
const editable = (t: EventTarget | null): boolean => t instanceof HTMLElement && /^(input|textarea|select)$/i.test(t.tagName) || (t instanceof HTMLElement && t.isContentEditable)
document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault() })
document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault() })

boot()
installHook()
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
