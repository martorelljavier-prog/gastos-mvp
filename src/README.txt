# PWA Pack — Gastos MVP

Archivos para hacer tu app instalable (iPhone/Android/Desktop) con soporte offline básico.

## Dónde copiar cada archivo
Copiá la carpeta `public/` a la carpeta `public` del proyecto Vite (si no existe, creala).

Quedará así:
- public/manifest.webmanifest
- public/sw.js
- public/icons/icon-192.png
- public/icons/icon-512.png
- public/icons/maskable-512.png

## Cambios en `index.html`
En <head> pegá:

<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0f172a">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Gastos">

Antes de cerrar </body>, registrá el SW (o hacelo en tu main.jsx):

<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js');
    });
  }
</script>

## Deploy
Solo subí a GitHub y Vercel. No hace falta config extra.

## Instalar en iPhone
1. Abrí la URL en Safari.
2. Botón Compartir → “Agregar a inicio”.
3. Abrí el ícono desde la pantalla de inicio.

## Notas
- Los íconos son de prueba. Podés reemplazarlos por PNGs reales 192×192 y 512×512.
- Si no ves el prompt de instalación, probá refrescar y abrir la web dos veces.
