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

JWT_EXPIRES_IN=8h
JWT_ISSUER=genius-quiz-api

FRONTEND_URL=https://tu-frontend.example
AUTH_ACTIVATION_TTL_MINUTES=1440
AUTH_RESET_TTL_MINUTES=60

CORS_ORIGINS=*

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

## Auth administrativo

```http
POST /auth/login
GET  /auth/me
POST /auth/forgot-password
POST /auth/activate
POST /auth/reset-password
```

Los JWT se revalidan contra el usuario actual en BD. Cambiar la contraseña invalida JWTs emitidos con la contraseña anterior sin requerir una columna adicional de versión.

Los tokens de activación y recuperación se envían como valores opacos y solamente su hash SHA-256 se almacena en `tokens_usuario`.

## Usuarios

Todos los endpoints requieren JWT y capability `usuarios:manage` (actualmente superadmin).

```http
GET    /users
GET    /users/:id
POST   /users
PATCH  /users/:id
DELETE /users/:id
POST   /users/:id/resend-activation
```

Crear usuario recibe `nombre`, `email` y `rol`. El usuario queda pendiente de establecer contraseña y se intenta enviar un enlace temporal de activación.

La eliminación es lógica. Cambiar rol, desactivar o eliminar un superadmin se valida transaccionalmente para impedir dejar el sistema sin un superadmin activo.

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

## Estructura
```text
src/
  app.js
  server.js
  config/
  middleware/
  modules/
    auth/
    users/
  routes/
  services/
  utils/
```

## Reglas técnicas
- SQL parametrizado; no concatenar entradas del usuario.
- Credenciales y secretos únicamente mediante variables/Secret Manager.
- Pool MySQL pequeño por instancia (inicialmente 5 conexiones).
- Timestamps reales en UTC; zona IANA por sesión para presentación/programación.
- Backend monolítico modular en un único servicio Cloud Run.
- El DDL y los cambios de estructura de BD se revisan antes de aplicarse.
