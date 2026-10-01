# Genius Quiz — API de sesiones

Contrato operativo del backend de sesiones para frontend/Lovable.

Base path: `/sesiones`

## Autenticación

### Administración
Enviar el JWT administrativo existente:

```http
Authorization: Bearer <jwt>
```

- `superadmin`: puede administrar cualquier sesión.
- `admin`: solo puede administrar sesiones creadas por su propio usuario.

### Participante
Al ingresar se devuelve un `access_token` opaco. Guardarlo en el navegador y, desde el frontend, enviarlo en el header ya permitido por CORS:

```http
Authorization: Bearer <access_token>
```

También se acepta `X-Application-Token: <access_token>` cuando el cliente pueda enviarlo.

El código de 6 dígitos localiza la sesión, pero no sustituye el token de una participación ya creada.

---

## Estados de sesión

El estado es derivado; no se persiste como columna independiente.

- `programada`: sesión programada antes de `fecha_inicio`.
- `activa`: ventana temporal válida y `aceptar_respuestas=true`.
- `en_espera`: ventana válida, ingresos abiertos y respuestas pausadas.
- `cerrada`: ambos controles apagados o sesión fuera de su ventana temporal.

`aceptar_ingresos` y `aceptar_respuestas` pueden guardarse como `true` antes del inicio de una sesión programada, pero no tienen efecto hasta `fecha_inicio`.

---

# Administración

## Opciones de evaluación para crear sesión

```http
GET /sesiones/opciones-evaluaciones
```

Devuelve evaluaciones activas con sus versiones publicadas y marca la versión activa.

## Listar sesiones

```http
GET /sesiones?search=<texto>
```

Superadmin recibe todas; admin únicamente las propias.

## Crear sesión

```http
POST /sesiones
Content-Type: application/json
```

Ejemplo:

```json
{
  "id_evaluacion": 1,
  "id_evaluacion_version": 3,
  "nombre": "True Colors · Grupo A",
  "descripcion": "Aplicación de cierre",
  "imagen_url": null,
  "tipo_sesion": "guiada",
  "programar_sesion": true,
  "fecha_inicio": "2026-10-02T10:00:00",
  "fecha_fin": "2026-10-02T12:00:00",
  "timezone": "America/Mexico_City",
  "aceptar_ingresos": true,
  "aceptar_respuestas": false,
  "configuracion": {
    "permitir_regresar": true,
    "mostrar_resultados": true,
    "permitir_reinicio": false
  }
}
```

Notas:

- `id_evaluacion_version` es opcional; si se omite se usa la versión activa publicada.
- Si no se envían `aceptar_ingresos` o `aceptar_respuestas`, su default es `false`.
- Si `programar_sesion=false`, las fechas se guardan como `NULL`.
- Fechas sin offset se interpretan en `timezone`; fechas ISO con `Z`/offset se convierten a UTC.
- En una sesión guiada creada con respuestas activas se selecciona automáticamente la primera pregunta.
- `config_presentacion` puede sobreescribir la presentación heredada de la versión.
- La respuesta incluye `codigo_acceso` y `join_url`, construido como `${FRONTEND_URL}/join/{codigo}`.

## Obtener sesión

```http
GET /sesiones/:id
```

## Editar sesión

```http
PATCH /sesiones/:id
```

Campos editables: `nombre`, `descripcion`, `imagen_url`, `tipo_sesion`, `programar_sesion`, fechas, `timezone`, `configuracion`, `config_presentacion`.

La versión de evaluación de una sesión no cambia después de crearla.

## Controles operativos

```http
PATCH /sesiones/:id/controles
```

```json
{
  "aceptar_ingresos": true,
  "aceptar_respuestas": true
}
```

Puede enviarse solo uno de los dos campos. En modo guiado, la primera activación de respuestas selecciona automáticamente la primera pregunta si todavía no existe `id_pregunta_actual`.

```http
POST /sesiones/:id/cerrar
POST /sesiones/:id/reabrir
```

`cerrar` apaga ambos toggles. `reabrir` enciende ambos únicamente si la sesión está dentro de su ventana temporal.

## Vista live / polling del anfitrión

```http
GET /sesiones/:id/live
```

Endpoint ligero para polling aproximado de 1 segundo. Devuelve:

- estado efectivo;
- conteos `por_aplicar`, `en_progreso`, `completadas`;
- aplicaciones en orden estable de ingreso;
- en guiada: pregunta actual, opciones, `respondieron_actual` y `sin_responder_actual`.

## Navegación guiada

```http
POST /sesiones/:id/guiada/navegar
```

```json
{
  "accion": "siguiente",
  "forzar": false
}
```

Acciones: `siguiente` o `anterior`.

Si se intenta avanzar y existen participantes sin responder, devuelve `409 PARTICIPANTS_PENDING`. Repetir con `forzar=true` para continuar de todos modos.

## Dashboard de resultados

```http
GET /sesiones/:id/resultados
```

Devuelve resumen, agregado dimensional y aplicaciones/resultados.

Detalle de una aplicación:

```http
GET /sesiones/:id/aplicaciones/:applicationId/resultados
```

Incluye resultado y respuestas legibles sin exponer marcadores de corrección en el payload de respuestas. Cuando el resultado contiene dimensiones, `resultado.dimensiones_principales` contiene la dimensión o dimensiones con mayor valor. Si la evaluación no tiene dimensiones, devuelve un arreglo vacío. El endpoint de participante usa el mismo campo en `resultado`.

Ambos endpoints de resultado incluyen `reporte_token`, un token de corta duración que el frontend puede usar en `GET /sesiones/reporte/:token` para abrir el reporte imprimible HTML.

## Correo de resultados desde administración

```http
POST /sesiones/:id/aplicaciones/:applicationId/email
```

```json
{
  "email": "persona@example.com"
}
```

Cuando `EMAIL_QUEUE_ENABLED=true`, el endpoint devuelve `202 Accepted` al agregar el envío a Cloud Tasks, sin esperar al SMTP. Ejemplo:

```json
{
  "ok": true,
  "data": {
    "id_envio": 55,
    "status": "pendiente",
    "email": "persona@example.com",
    "solicitud_recibida": true,
    "mensaje": "Solicitud recibida; el correo está pendiente de envío."
  }
}
```

El trabajador cambia el registro a `enviando` mientras procesa y termina en `exito` o `error`. El correo es HTML, no lleva PDF adjunto. La cola se configura con concurrencia máxima 1 para procesar un envío a la vez.

Historial:

```http
GET /sesiones/:id/envios
```

Reintentar únicamente un envío con `status=error`:

```http
POST /sesiones/:id/envios/:sendId/reintentar
```

En modo cola, el reintento también responde `202 Accepted`; el historial muestra su progreso.

## Eliminar sesión

```http
DELETE /sesiones/:id
```

Borrado lógico (`deleted_at`, `deleted_by`).

---

# Participante

## Consultar un código

```http
GET /sesiones/join/:codigo
```

Devuelve información pública y flags `puede_ingresar` / `puede_responder`. Esta consulta no registra al participante.

## Ingresar

```http
POST /sesiones/join/:codigo
Content-Type: application/json

{
  "nombre": "María"
}
```

Si se crea la participación devuelve `201` y un `access_token`.

Si el navegador ya conserva el token de esa sesión, enviarlo como `Authorization: Bearer <access_token>`; el backend reanuda la misma aplicación y devuelve `200`.

Si la sesión todavía no llega a `fecha_inicio`, no se permite registrar una nueva aplicación aunque los toggles estén guardados en `true`.

## Estado / polling

```http
GET /sesiones/participacion/estado
Authorization: Bearer <access_token>
```

Diseñado para polling aproximado de 1 segundo. Devuelve estado de sesión, estado de aplicación, progreso y pregunta activa en modo guiado.

## Iniciar después de sala de espera

```http
POST /sesiones/participacion/iniciar
Authorization: Bearer <access_token>
```

Se usa cuando la aplicación estaba `por_aplicar` y el anfitrión habilita respuestas posteriormente.

## Obtener pregunta

```http
GET /sesiones/participacion/pregunta
```

En modo guiado devuelve la pregunta global actual.

En modo individual puede solicitarse:

```http
GET /sesiones/participacion/pregunta?orden=3
```

Si `permitir_regresar=false`, el backend impide regresar a preguntas anteriores al último avance registrado.

## Guardar respuesta

```http
PUT /sesiones/participacion/respuestas/:questionId
```

Body según tipo:

```json
{ "valor": 12 }
```

```json
{ "valor": [12, 15] }
```

```json
{ "valor": [15, 12, 18, 20] }
```

Corresponden a `single_choice`, `multiple_choice` y `ranking`.

El backend valida opciones, min/max, ranking completo, pausa/ventana temporal y, en guiada, que la pregunta sea la activa.

## Finalizar

```http
POST /sesiones/participacion/finalizar
```

Valida preguntas requeridas, calcula score correcto, score máximo y dimensiones, guarda snapshot de presentación y cambia la aplicación a `completada`.

Si `mostrar_resultados=false`, la finalización es exitosa pero el resultado no se expone al participante.

## Ver resultado

```http
GET /sesiones/participacion/resultados
```

Incluye resultado, `dimensiones_principales`, `reporte_token` y respuestas read-only cuando `mostrar_resultados=true). El campo `dimensiones_principales` queda vacío si el test no contempla dimensiones. El frontend puede usar `reporte_token` para abrir el reporte en una página HTML separada y llamar a impresión desde el navegador.

El reporte público se consulta así:

```http
GET /sesiones/reporte/:token
```

## Reiniciar

```http
POST /sesiones/participacion/reiniciar
```

Disponible solo si `permitir_reinicio=true` y la sesión acepta respuestas. Elimina respuestas y resultado actuales, conserva historial de correos y regresa a `en_progreso`.

## Enviar resultados por correo

```http
POST /sesiones/participacion/resultados/email

{
  "email": "persona@example.com"
}
```

Registra el intento en `envios_correo` y usa el SMTP ya configurado en el servicio. En modo cola devuelve `202 Accepted` con `status=pendiente`; el frontend debe mostrar que la solicitud se recibió, no que el correo ya se envió. Si la cola está desactivada, el modo local procesa el envío de forma síncrona.

---

## Errores

Formato uniforme existente del API:

```json
{
  "ok": false,
  "error": {
    "code": "SESSION_NOT_STARTED",
    "message": "La sesión todavía no inicia.",
    "request_id": "..."
  }
}
```

Validaciones que requieren detalle pueden incluir `error.details`.
