# Despliegue — contenedor único

Desde esta rama el sistema se despliega como **un solo servicio de aplicación**
(antes eran dos: `backend` Python + `frontend` Nginx).

## Cómo funciona

`Dockerfile` (raíz) es multi-stage:

1. **Etapa `frontend` (Node 20):** `npm ci` + `npm run build` en `app/static/` → genera `dist/`.
2. **Etapa Python:** instala `requirements.txt`, copia el backend y copia el
   `dist/` de la etapa anterior a `app/static/dist/`.

Flask ya estaba preparado para servir la SPA:

- `static_folder='static/dist'`, `static_url_path=''` en `app/__init__.py`
- `_try_serve_index()` y `spa_fallback()` sirven `index.html` para las rutas de React Router
- Las rutas `/api/v1/...` las atiende el mismo proceso

El frontend llama al backend con rutas **relativas** (`fetch('/api/v1/...')`),
así que al servirse todo desde el mismo origen no hace falta CORS ni proxy.

## `docker-compose.yml`

Servicios: `db` (Postgres) y `backend` (la app completa). Ya no hay `frontend`.

## Acción manual en Coolify tras el merge

El FQDN público apuntaba al contenedor `frontend:80`. Ahora hay que apuntarlo
al **`backend`, puerto `5000`**:

1. Coolify → aplicación → **Domains / Ports**.
2. Cambiar el mapeo del dominio a `backend:5000` (o el puerto expuesto).
3. Redeploy.
4. Verificar:
   - `https://<tu-dominio>/` → carga el frontend
   - `https://<tu-dominio>/api/v1/health` → `200` con `"gemini_key": true`

## Archivos que quedan sin usar (se conservan por si se revierte)

- `app/static/Dockerfile`
- `app/static/nginx.conf`

## Contrapartidas

- Un cambio solo de frontend obliga a reconstruir la imagen del backend.
- Gunicorn sirve los estáticos (suficiente a esta escala; se puede añadir
  WhiteNoise o un CDN más adelante).
