# ─────────────────────────────────────────────────────────────────────────────
# Imagen única: Flask (API) + React ya compilado servido por el mismo proceso.
# Antes eran 2 contenedores (backend Python + frontend Nginx). Ahora es 1 solo:
# Flask sirve app/static/dist/ con su fallback SPA (_try_serve_index / spa_fallback).
# ─────────────────────────────────────────────────────────────────────────────

# ── Etapa 1: build del frontend (Node) ──────────────────────────────────────
# Vite 8 exige Node ^20.19 || >=22.12 — usamos 22 para no depender del patch de la 20.
FROM node:22-alpine AS frontend

WORKDIR /build

# Instalar dependencias con el lockfile (cacheable si package*.json no cambia)
COPY app/static/package.json app/static/package-lock.json* ./
RUN npm ci

# Copiar el código del frontend y compilar → genera /build/dist
COPY app/static/ ./
RUN npm run build


# ── Etapa 2: backend (Python) ───────────────────────────────────────────────
FROM python:3.10-slim

WORKDIR /app

# No se requiere gcc ni libpq-dev porque requirements.txt usa psycopg2-binary precompilado

# Dependencias de Python (cacheable si requirements.txt no cambia)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Código del backend (excepto lo excluido en .dockerignore)
COPY . .

# Traer el frontend ya compilado desde la etapa Node.
# Flask está configurado con static_folder='static/dist' y static_url_path=''
COPY --from=frontend /build/dist ./app/static/dist

# Puerto del servidor Flask/Gunicorn
EXPOSE 5000

# wsgi:app levanta el túnel SSH (si hay credenciales) y hace la init/seed de BD.
CMD ["bash", "-c", "gunicorn --bind 0.0.0.0:5000 --workers 2 wsgi:app"]
