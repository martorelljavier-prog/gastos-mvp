import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

const root = createRoot(document.getElementById('root'))
root.render(<App />)
// Registrar el Service Worker para que la app sea instalable y funcione offline
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
