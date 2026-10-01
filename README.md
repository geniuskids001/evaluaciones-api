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

## Envío de resultados por correo

Los correos de resultados se envían como HTML y no generan ni adjuntan PDF en el backend. El correo incluye un gráfico HTML estático compatible con clientes de correo y las dimensiones principales. El endpoint de resultados también entrega `reporte_token` para que el frontend pueda abrir el reporte HTML y ofrecer impresión desde el navegador.

Para mantener la API ligera en producción, habilita Cloud Tasks y configura la cola antes de activar `EMAIL_QUEUE_ENABLED=true`. La cola debe tener `maxConcurrentDispatches=1` para procesar un envío por vez en todo el servicio. El API responde HTTP 202 cuando el envío quedó aceptado; el registro existente en `envios_correo` pasa por `pendiente`, `enviando`, y termina en `exito` o `error`.

Variables requeridas:
```text
EMAIL_QUEUE_ENABLED=true
CLOUD_TASKS_PROJECT_ID=bgk-system
CLOUD_TASKS_LOCATION=us-central1
CLOUD_TASKS_QUEUE_ID=genius-quiz-email
CLOUD_TASKS_WORKER_URL=https://<URL_CLOUD_RUN>/sesiones/tasks/email
CLOUD_TASKS_WORKER_AUDIENCE=https://<URL_CLOUD_RUN>
CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL=genius-quiz-email-task@bgk-system.iam.gserviceaccount.com
```

Configuración inicial de Google Cloud (sustituye `<PROJECT_NUMBER>` y la URL real del servicio):

```bash
gcloud services enable cloudtasks.googleapis.com --project=bgk-system

gcloud tasks queues create genius-quiz-email \
  --location=us-central1 \
  --max-dispatches-per-second=1 \
  --max-concurrent-dispatches=1

gcloud iam service-accounts create genius-quiz-email-task \
  --project=bgk-system \
  --display-name="Genius Quiz email task caller"

gcloud projects add-iam-policy-binding bgk-system \
  --member="serviceAccount:bgk-cloudrun-sa@bgk-system.iam.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer"

gcloud run services add-iam-policy-binding evaluacion-api \
  --project=bgk-system \
  --region=us-central1 \
  --member="serviceAccount:genius-quiz-email-task@bgk-system.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

gcloud iam service-accounts add-iam-policy-binding \
  genius-quiz-email-task@bgk-system.iam.gserviceaccount.com \
  --project=bgk-system \
  --member="serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-cloudtasks.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

Después de desplegar el código, configura las variables de la cola en Cloud Run y establece `EMAIL_QUEUE_ENABLED=true`. El endpoint del trabajador valida el token OIDC de Cloud Tasks y el correo de la cuenta de servicio configurada. El trabajador reclama cada envío de forma condicional para ignorar tareas duplicadas; aun así, el proveedor SMTP puede aceptar un correo justo antes de un fallo de red o de base de datos, por lo que no se puede prometer entrega exactamente una vez.

En desarrollo local deja `EMAIL_QUEUE_ENABLED=false`; los envíos se procesan de forma síncrona y no usan Chromium.
