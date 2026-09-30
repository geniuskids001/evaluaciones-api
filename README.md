# Genius Quiz — Evaluaciones API

Backend de **Genius Quiz**, plataforma independiente para crear y administrar evaluaciones y sesiones en vivo.

## Stack
- Node.js + Express
- MySQL 8.4
- Google Cloud Run
- Google Cloud SQL
- JWT para usuarios administrativos
- SMTP (Gmail) para correo

## Infraestructura actual
- Proyecto GCP: `bgk-system`
- Región: `us-central1`
- Cloud SQL: `bgk-sql-1`
- Base de datos: `evaluations_app_bd`
- Usuario de aplicación: `evaluation_app_user`
- Cloud Run: `evaluacion-api`
- Puerto: `8080`
- Zona de negocio por defecto: `America/Mexico_City`

## Variables de entorno
```text
NODE_ENV=production
TZ=America/Mexico_City
APP_TIMEZONE=America/Mexico_City
DB_USER=evaluation_app_user
DB_NAME=evaluations_app_bd
DB_SOCKET_PATH=/cloudsql/bgk-system:us-central1:bgk-sql-1
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=direccion@geniuskids.mx
SMTP_FROM=Genius Quiz <evaluaciones@geniuskids.mx>
SMTP_SECURE=false
```

Secrets requeridos (no se guardan en Git):
- `DB_PASSWORD`
- `JWT_SECRET`
- `SMTP_PASS`

## Arranque local
```bash
npm install
npm run dev
```

El servidor usa `process.env.PORT` y por defecto escucha en `8080`.

## Health check
```http
GET /health
```

Respuesta esperada:
```json
{
  "ok": true,
  "service": "evaluacion-api",
  "timestamp": "2026-09-30T..."
}
```

## Estructura inicial
```text
src/
  app.js
  server.js
  config/
    db.js
  routes/
    health.routes.js
```

## Reglas técnicas
- SQL parametrizado; no concatenar entradas del usuario.
- Credenciales y secretos únicamente mediante variables/Secret Manager.
- Pool MySQL pequeño por instancia (inicialmente 5 conexiones).
- Timestamps reales en UTC; zona IANA por sesión para presentación/programación.
- Backend monolítico modular en un único servicio Cloud Run.
- El DDL y los cambios de estructura de BD se revisan antes de aplicarse.
