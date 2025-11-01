# Gastos — MVP (React + Vite)

## Cómo desplegar en Vercel (sin instalar nada)
1. Crear un repo en GitHub (New Repository) y dejarlo vacío por ahora.
2. Descargar este ZIP y descomprimir.
3. Subir el contenido de la carpeta al repo (GitHub → Add file → Upload files → drag & drop todas las carpetas y archivos).
4. Ir a https://vercel.com → New Project → Importar tu repo.
5. En Settings → Environment Variables agregar:
   - NEXT_PUBLIC_SUPABASE_URL = https://qugnkfjbfqcihummbaal.supabase.co
   - NEXT_PUBLIC_SUPABASE_ANON_KEY = (no necesario aquí porque el valor ya está embebido en App.jsx; opcional moverlo a env)
6. Deploy.

## Scripts locales (opcional, si tenés Node.js)
npm install
npm run dev
