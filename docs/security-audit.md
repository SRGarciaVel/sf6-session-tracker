# Auditoría de seguridad pre-producción — SF6 Session Tracker + SF6 Session Companion

**Fecha:** 2026-10-04.

**Alcance:** todo el repositorio:

- app Next.js (rutas, server actions, auth);
- worker;
- PostgreSQL / Drizzle;
- SSE y overlay OBS;
- API del companion;
- extensión MV3 y paquete `@sf6/capcom-core`;
- dependencias y configuración de despliegue prevista (Vercel + Render + Supabase).

**Método:**

- revisión de código manual;
- pruebas ofensivas **solo en local** (DB de test, Chromium local);
- secret scanning del árbol y del historial git;
- `pnpm audit`.

Sin pruebas contra Capcom/Buckler.

**Estado:** **READY_WITH_ACCEPTED_RISKS** para beta cerrada, **condicionado** a la lista de
requisitos de producción (§7). Varios son pasos de configuración obligatorios, no código.

## 1. Modelo de amenazas

| Actor                                            | Capacidades                                                   | Objetivo típico                                                        |
| ------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Visitante anónimo                                | Peticiones HTTP arbitrarias, muchas IPs                       | Fuerza bruta de login/pairing, DoS, enumerar overlays                  |
| Usuario registrado (registro abierto)            | Cuenta propia, companion propio, payloads de sync arbitrarios | Leer o alterar datos de otra cuenta, inyectar contenido en otro stream |
| Espectador con la URL del overlay                | URL filtrada en stream o captura                              | Leer estadísticas, abrir conexiones SSE masivas                        |
| Página web maliciosa en el navegador del usuario | JS en otro origen                                             | Hablar con la extensión, CSRF contra el tracker                        |
| Proceso/pestaña de Buckler                       | JS de la propia página de Buckler                             | Alterar lo que lee el companion (solo datos propios)                   |

**Datos sensibles:**

- credenciales de la cuenta y cookies de sesión del tracker;
- device tokens del companion;
- cookies de Capcom, que **nunca** salen del navegador;
- CFN, nombre de luchador e historial de partidas con nombres de rivales.

## 2. Superficie de ataque

| Superficie           | Ruta / mecanismo                                                                                            | Autenticación                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Páginas públicas     | `/`, `/login`, `/signup`                                                                                    | —                                                 |
| Auth                 | `/api/auth/*` (Better Auth: sign-up, sign-in, sign-out, get-session, list/revoke-session, update-user)      | Cookie de sesión (y ninguna para sign-in/up)      |
| Páginas de la app    | `/onboarding`, `/dashboard`, `/dashboard/sessions/[id]`, `/dashboard/overlays/[id]`                         | Cookie; ownership comprobado                      |
| Server actions       | `dashboard/actions.ts` (sesión, overlays, dev tools, companion), `onboarding/actions.ts`, `i18n/actions.ts` | Cookie + comprobación de Origin de Next           |
| Overlay OBS          | `/overlay/[token]`, `/api/overlay/[token]/state`, `/api/overlay/[token]/stream` (SSE)                       | Token de 192 bits en la URL (solo lectura)        |
| Stream del dashboard | `/api/me/stream` (SSE)                                                                                      | Cookie                                            |
| API del companion    | `/api/companion/pair` · `state` · `sync` · `disconnect`                                                     | Bearer device token (pair: código de un solo uso) |
| Salud                | `/api/health`                                                                                               | —                                                 |
| Worker               | Proceso Node; Postgres (leases); provider configurado                                                       | —                                                 |
| DB                   | Postgres; `LISTEN/NOTIFY` para tiempo real                                                                  | Credenciales de servidor                          |
| Extensión MV3        | Service worker, popup, `chrome.scripting` en pestañas de Buckler                                            | Mensajes solo de su propio id                     |

## 3. Hallazgos

| ID      | Severidad | CWE           | Componente                                       | Estado                     |
| ------- | --------- | ------------- | ------------------------------------------------ | -------------------------- |
| SEC-001 | HIGH      | CWE-639, 345  | Companion snapshot / provider                    | FIXED                      |
| SEC-002 | MEDIUM    | CWE-307       | Better Auth rate limit                           | FIXED                      |
| SEC-003 | MEDIUM    | CWE-770       | Rate limiter de la app                           | FIXED                      |
| SEC-004 | MEDIUM    | CWE-400       | SSE (overlay y dashboard)                        | FIXED                      |
| SEC-005 | MEDIUM    | CWE-693, 1021 | Cabeceras HTTP                                   | FIXED                      |
| SEC-006 | MEDIUM    | CWE-1188, 798 | Configuración (`BETTER_AUTH_SECRET`)             | FIXED                      |
| SEC-013 | MEDIUM    | CWE-348       | Resolución de la IP del cliente                  | FIXED                      |
| SEC-025 | HIGH*     | CWE-284       | Despliegue en Supabase (Data API)                | REQUISITO (§7)             |
| SEC-010 | LOW       | CWE-613       | Device tokens del companion                      | FIXED                      |
| SEC-007 | LOW       | CWE-598       | Token del overlay en la URL                      | ACCEPTED                   |
| SEC-008 | LOW       | CWE-204       | Enumeración de cuentas en sign-up                | ACCEPTED                   |
| SEC-015 | LOW       | —             | Privacidad / retención                           | ACCEPTED (documentado)     |
| SEC-024 | LOW       | —             | Registro abierto en beta cerrada                 | ACCEPTED (recomendación)   |
| SEC-009 | INFO      | —             | Sin verificación de email ni reset de contraseña | ACCEPTED                   |
| SEC-011 | INFO      | —             | `pnpm audit` (solo dev)                          | ACCEPTED                   |
| SEC-014 | INFO      | —             | CORS `*` del companion                           | FALSE POSITIVE (seguro)    |
| SEC-016 | INFO      | CWE-79        | XSS                                              | FALSE POSITIVE (con tests) |
| SEC-017 | INFO      | CWE-362       | Pairing concurrente                              | FALSE POSITIVE (con tests) |
| SEC-018 | INFO      | CWE-352       | CSRF                                             | FALSE POSITIVE             |
| SEC-019 | INFO      | CWE-601       | Open redirect                                    | FALSE POSITIVE             |
| SEC-020 | INFO      | CWE-918       | SSRF                                             | FALSE POSITIVE             |
| SEC-021 | INFO      | —             | Extensión MV3                                    | FALSE POSITIVE             |
| SEC-023 | INFO      | —             | Pooler de Supabase / `LISTEN`                    | REQUISITO (§7)             |

\* SEC-025 es un riesgo de **configuración del despliegue**, no del código. Es crítico si se
despliega en Supabase sin el paso del §7.

### SEC-001 — Inyección de datos entre cuentas y secuestro de CFN vía companion (HIGH, FIXED)

- **Archivos:**
  - `src/server/companion/service.ts`;
  - `src/server/sf6/providers/companion.ts`;
  - `src/server/db/schema.ts` (`companion_snapshot`).
- **Condición:** registro abierto y CFN de la víctima conocido (es público).
- **Evidencia:**
  - `companion_snapshot` tenía PK `cfn_user_id`, es decir, una sola fila global por CFN;
  - el provider `companion` la leía **solo por CFN**;
  - los datos del companion los afirma el cliente: con su device token, un atacante puede enviar
    cualquier payload normalizado sin pasar por Buckler.
- **Explotación (reproducida en el test de regresión):**
  1. El atacante empareja un companion, envía un perfil o partidas inventadas (con texto
     arbitrario en nombres, que acaba **en el stream de la víctima**) para el CFN de la víctima y
     registra ese CFN en su propia cuenta.
  2. La víctima registra su CFN: el lookup del onboarding, el inicio de sesión y el overlay usan
     los datos del atacante.
  3. El companion de la víctima recibe `409 cfn_owned_by_other` para siempre, porque el
     atacante "rastrea" el CFN.
- **Impacto:** integridad del overlay y estadísticas de otra cuenta, inyección de contenido en
  su stream y denegación de servicio dirigida.
- **Fix:**
  - snapshot por cuenta: PK `(user_id, cfn_user_id)` (migración `0005`);
  - `ProviderCallOptions.scope.userId`; el provider `companion` **rechaza** lecturas sin scope y
    solo lee el snapshot de esa cuenta;
  - `ResilientProvider` incluye el scope en las claves de caché y de single-flight;
  - inicio y fin de sesión, worker y onboarding pasan la cuenta propietaria;
  - eliminada la lógica de propiedad o "takeover" entre cuentas, que ya no hace falta.
- **Tests:**
  - `tests/integration/companion.test.ts` (SEC-001: reproducción del ataque y que no se lea sin
    scope);
  - `tests/integration/security.test.ts` (IDOR de snapshots).

### SEC-002 — Rate limit de Better Auth en memoria por instancia (MEDIUM, FIXED)

- **Evidencia:**
  - `rateLimit.storage` por defecto es `"memory"`;
  - en Vercel cada instancia serverless tiene su propio contador, así que la regla de sign-in
    (3 cada 10 s por IP) se multiplica por el número de instancias.
- **Fix:**
  - `storage: "database"` con la tabla `auth_rate_limit` (migración `0006`) cuando
    `RATE_LIMIT_STORE=postgres`, que es el valor por defecto en producción;
  - la IP sale de `CLIENT_IP_HEADER` con `TRUST_PROXY`.
- **Test:** `tests/integration/rate-limit.test.ts`: el 4.º sign-in fallido da 429 y el contador
  está en Postgres.

### SEC-003 — Rate limiter de la app en memoria (MEDIUM, FIXED)

- **Evidencia:** `src/server/security/rate-limit.ts` usaba un `Map` por proceso. Afecta a
  pairing, sync, state, overlay, lookup de CFN, inicio de sesión y creación de códigos: con N
  instancias los límites son N veces más laxos y se evaden repartiendo las peticiones.
- **Fix:**
  - interfaz async común con dos almacenes:
    - **memory** (dev y tests);
    - **postgres**: un único `INSERT … ON CONFLICT DO UPDATE` atómico sobre `rate_limit_bucket`,
      compartido por todas las instancias y sin infraestructura nueva;
  - `RATE_LIMIT_STORE` es `postgres` por defecto en producción;
  - modo de fallo explícito: **fail-closed** en pairing y creación de códigos (objetivos de
    fuerza bruta), **fail-open** en el resto (disponibilidad; si la DB está caída, esas rutas
    fallan igualmente).
- **Tests:**
  - 50 peticiones concurrentes desde 2 "instancias" permiten **exactamente** el límite;
  - reset de ventana;
  - fail-open y fail-closed.
- **Redis/Upstash:** no hace falta todavía. La interfaz `RateLimitStore` admite un adaptador
  Upstash (un `INCR` + `PEXPIRE`) si Postgres se convierte en cuello de botella.

### SEC-004 — Agotamiento de conexiones SSE (MEDIUM, FIXED)

- **Evidencia:**
  - el rate limit acotaba solo la **apertura** (60/min/IP en el overlay), no las conexiones
    abiertas;
  - cada stream de overlay registra presencia, hace un heartbeat a la DB cada 30 s y publica
    eventos;
  - con una URL de overlay filtrada se pueden acumular cientos de streams;
  - `/api/me/stream` no tenía límite por cuenta.
- **Fix** (`src/server/realtime/connection-limits.ts`):
  - topes concurrentes por proceso: 10 por overlay, 30 por IP y 5 por cuenta en el dashboard;
  - asignación todo-o-nada;
  - liberación idempotente al cerrar, al abortar o si falla el setup.

### SEC-005 — Sin CSP, HSTS ni COOP (MEDIUM, FIXED)

- **Fix** (`next.config.ts`), CSP por superficie:
  - **app y auth:** `default-src 'self'`; `script-src 'self' 'unsafe-inline'` (el bootstrap de
    Next es inline); `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
    `frame-ancestors 'none'`; más `X-Frame-Options: DENY` y
    `Cross-Origin-Opener-Policy: same-origin`;
  - **overlay:** la misma CSP, pero `frame-ancestors *` y sin X-Frame-Options, porque OBS y
    algunas herramientas lo incrustan;
  - **HSTS** (2 años) cuando `APP_URL` es https;
  - `'unsafe-eval'` y `ws:` solo en dev.
- **Verificado** con un build de producción en Chromium: cero violaciones de CSP, hidratación e
  interacción correctas.
- **Riesgo residual:** `'unsafe-inline'` en `script-src`. Una CSP con nonce requeriría un proxy
  y renderizado dinámico total. No hay sumideros HTML (SEC-016), así que el riesgo es bajo.

### SEC-006 — Secreto de `.env.example` aceptado en producción (MEDIUM, FIXED)

- **Evidencia:** el placeholder `BETTER_AUTH_SECRET` (público en el repo) mide más de 32
  caracteres, así que pasaba la validación. Desplegar copiando `.env.example` dejaba un secreto
  de firma conocido.
- **Fix:** con `NODE_ENV=production`, `getEnv()` rechaza los placeholders conocidos y cualquier
  valor con "change-me".
- **Test:** `src/server/env.test.ts`.

### SEC-013 — IP del cliente falsificable detrás de un proxy (MEDIUM, FIXED)

- **Evidencia:**
  - con `TRUST_PROXY=true`, `getClientIp` usaba la entrada **más a la izquierda** de
    `X-Forwarded-For`, que controla el cliente (los proxies añaden a la derecha);
  - un atacante evadía los límites por IP (pairing, overlay) cambiando la cabecera.
- **Fix:**
  - se usa la entrada **más a la derecha** de la cabecera configurada (`CLIENT_IP_HEADER`; en
    Vercel `x-real-ip`);
  - Better Auth lee esa misma cabecera.
- **Test:** `src/server/env.test.ts`.

### SEC-025 — Data API de Supabase expone las tablas (HIGH si se despliega sin mitigar; REQUISITO)

- **Evidencia:**
  - Supabase publica el esquema `public` vía PostgREST con la clave `anon`, que es pública por
    diseño;
  - nuestras tablas (`auth_session`, `auth_account` con hashes de contraseña,
    `companion_device`, `match`…) no tienen RLS, porque la propiedad se aplica en la app;
  - sin mitigación, cualquiera podría leer o escribir la base de datos entera.
- **Mitigación obligatoria** antes de desplegar en Supabase (no es una migración, porque es
  específica de la plataforma):

  ```sql
  -- Supabase SQL editor (o desactivar "Data API" en Settings → API).
  revoke all on all tables    in schema public from anon, authenticated;
  revoke all on all sequences in schema public from anon, authenticated;
  revoke all on all functions in schema public from anon, authenticated;
  alter default privileges in schema public revoke all on tables    from anon, authenticated;
  alter default privileges in schema public revoke all on sequences from anon, authenticated;
  alter default privileges in schema public revoke all on functions from anon, authenticated;
  ```

  Verificación: `curl https://<ref>.supabase.co/rest/v1/auth_user -H "apikey: <anon>"` debe
  devolver 401 o 404, nunca filas.

### SEC-010 — Device tokens sin caducidad (LOW, FIXED)

- **Fix:** un token sin uso durante **90 días** se revoca en su siguiente uso
  (`DEVICE_INACTIVITY_REVOKE_MS`). Un companion activo sincroniza cada 30–120 s, así que no
  afecta al uso real.
- **Revisado y correcto:**
  - 256 bits de `randomBytes`;
  - solo el SHA-256 en la DB, con búsqueda por hash, así que no hay comparación en tiempo
    variable de secretos;
  - el token nunca aparece en logs ni en respuestas, salvo una vez en `/pair`;
  - el popup no lo ve (`toPublicStatus`);
  - alcance limitado a `/api/companion/*`.
- **No añadido:** rotación ni fingerprint de dispositivo. No aportan seguridad real aquí: no hay
  señal de dispositivo verificable y la revocación ya existe.

### SEC-007 — Token del overlay en la URL (LOW, ACCEPTED)

- **Qué hace el token:** son 192 bits que no derivan de ningún id (no se pueden enumerar) y es
  solo lectura: no existe ninguna acción mutativa con él.
- **Qué expone:** las estadísticas públicas de la sesión. El payload no incluye ids internos
  (hay un test).
- **Mitigaciones:**
  - `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `no-store`;
  - rotación desde el dashboard: la URL anterior deja de funcionar al instante y los SSE
    abiertos reciben `revoked`;
  - tope de streams (SEC-004).
- **Aceptado:** aparece en los logs de acceso del hosting y puede filtrarse en el stream; si
  ocurre, se rota.

### SEC-008 — Enumeración de cuentas (LOW, FIXED en Phase 4.6)

- **Qué pasaba:** el sign-up respondía "el usuario ya existe".
- **Corrección (Phase 4.6, [auth.md](auth.md#account-enumeration)):**
  - con `requireEmailVerification`, un sign-up duplicado devuelve la misma respuesta genérica que
    uno nuevo (usuario sintético de Better Auth, sin sesión);
  - "olvidé mi contraseña" y "reenviar verificación" responden igual exista o no la cuenta;
  - los correos se encolan sin bloquear la respuesta;
  - hay límites por IP y por email (hash con clave).
- **Residual:** hay pequeñas diferencias de tiempo por escrituras en BD, acotadas por el rate
  limit. No se promete indistinguibilidad perfecta.

### SEC-026 — Email sin verificar y sin recuperación de cuenta (MEDIUM, FIXED en Phase 4.6)

- **Qué pasaba:**
  - cualquiera podía registrarse con un correo ajeno y obtener sesión al instante;
  - no había forma de recuperar una contraseña olvidada.
- **Corrección:**
  - **verificación obligatoria** antes de cualquier sesión, con enlaces JWT firmados de 60 min;
  - **gate central** `getVerifiedSession()`, que también ignora sesiones antiguas de cuentas sin
    verificar;
  - **reset de contraseña** nativo de Better Auth:
    - de un solo uso, 60 min, con el token guardado hasheado;
    - revoca todas las sesiones;
  - callbacks limitados a páginas propias (sin open redirect);
  - logs sin direcciones, enlaces ni tokens;
  - `RESEND_API_KEY` y `EMAIL_FROM` obligatorios en producción (fail closed).
- **Despliegue:** cuentas existentes y cuenta de QA según [auth.md § Existing accounts](auth.md#existing-accounts-rollout).

### SEC-015 — Privacidad y retención (LOW, ACCEPTED, documentado)

| Dato                                          | Dónde                                   | Retención actual                                      |
| --------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Email, nombre, hash de contraseña             | `auth_user`, `auth_account`             | Hasta borrar la cuenta (sin flujo de borrado todavía) |
| IP y User-Agent de cada sesión web            | `auth_session` (Better Auth)            | Hasta caducar la sesión (30 días)                     |
| CFN, nombre de luchador, ratings              | `sf6_player`, `player_character_rating` | Indefinida                                            |
| Partidas con **nombre y personaje del rival** | `match`                                 | Indefinida                                            |
| Snapshot del companion (perfil y 30 partidas) | `companion_snapshot`                    | Se sobrescribe en cada sync                           |
| Dispositivos (nombre, último uso)             | `companion_device`                      | Indefinida; revocación automática a 90 días sin uso   |
| Logs                                          | stdout de la plataforma                 | Sin payloads, tokens ni nombres de rivales            |

**Riesgos pendientes:** no hay borrado de cuenta ni exportación (RGPD), y no hay purga de
partidas antiguas. Hay que resolverlo antes de una beta abierta.

### SEC-024 — Registro abierto (LOW, recomendación)

En beta cerrada conviene limitar el registro a una lista de emails o invitaciones (hook
`before` de sign-up en Better Auth). No implementado. Desde Phase 4.6 cada cuenta debe probar
que controla su correo y el sign-up tiene un límite de 5 / 15 min por IP; CAPTCHA solo si los
logs muestran abuso distribuido.

### SEC-009, 011, 014, 016–021, 023 — Sin vulnerabilidad (detalle en §4)

## 4. Revisión por área

- **Auth (Better Auth 1.7.7):**
  - cookies `HttpOnly`, `SameSite=Lax`, `Secure` con https, `Path=/`, sin `Domain`;
  - la sesión se crea en cada login (sin fijación de sesión) y se revoca en logout;
  - `trustedOrigins=[APP_URL]`: Better Auth comprueba el Origin en los POST y valida
    `callbackURL` contra él;
  - el campo `locale` no es escribible por la API (`input: false`);
  - no hay borrado de usuario ni cambio de email activados.
- **IDOR:**
  - cada server action y página resuelve la cuenta desde la sesión;
  - overlays (`getOwnedOverlay`), sesiones (`getOwnedSession`), dispositivos (`revokeDevice` con
    `user_id`) y snapshots (scope) filtran por propietario;
  - los UUID se validan antes de consultar;
  - tests: `authorization.test.ts`, `security.test.ts`.
- **Companion:** ver SEC-001 y SEC-010.
  - el top-level de `/sync` es `strictObject` (una clave desconocida da 422);
  - hasta 100 partidas y 256 KB, limitados **mientras se lee** el stream;
  - las fechas se validan con `z.iso.datetime` y la ventana 2023-06-01 → ahora + 5 min;
  - los enteros se validan con `z.number().int()`, lo que rechaza NaN e Infinity (`JSON.parse`
    no produce ninguno de los dos);
  - Zod descarta las claves desconocidas, así que no hay prototype pollution.
- **Pairing (SEC-017):**
  - 8 caracteres Crockford (40 bits), TTL de 10 min, un solo uso;
  - `SELECT … FOR UPDATE` con `used_at IS NULL` en el `WHERE`: en READ COMMITTED, la segunda
    transacción re-evalúa la fila bloqueada, ya no cumple el predicado y no obtiene nada;
  - **test:** 10 canjes concurrentes del mismo código dan exactamente 1 dispositivo;
  - el mismo error para códigos usados, inexistentes o caducados (sin oráculo);
  - 10 intentos/min por IP en Postgres: con 1,1·10¹² códigos posibles, adivinar es inviable.
- **XSS (SEC-016):**
  - no hay `dangerouslySetInnerHTML`, `innerHTML` ni `eval`;
  - React escapa todo; el popup de la extensión usa `textContent`;
  - los colores del overlay se validan como `#rrggbb` y las fuentes como enum (sin inyección de
    CSS);
  - **tests:** cargas `<script>`, `"><img onerror>`, `</style><script>` y `javascript:` en todos
    los campos de nombre, rango y título se renderizan como texto, y un string hostil no puede
    partir frames SSE.
- **CORS (SEC-014):**
  - el `*` solo está en `/api/companion/*`, que se autentica por Bearer y **nunca** devuelve
    `Access-Control-Allow-Credentials` (hay test);
  - el resto de rutas son same-origin y no envían cabeceras CORS.
- **CSRF (SEC-018):**
  - las server actions tienen la comprobación de Origin de Next;
  - Better Auth comprueba el Origin y las cookies son `SameSite=Lax`;
  - las rutas GET son de solo lectura;
  - el companion usa Bearer, así que no aplica.
- **Open redirect (SEC-019):** solo hay `redirect()` a rutas fijas (`/login`, `/onboarding`,
  `/dashboard`); no existen parámetros `next`, `returnTo` ni `callback` propios.
- **SSRF (SEC-020):**
  - el servidor solo hace fetch a `CAPCOM_BASE_URL` (provider capcom, no usado en producción);
  - la URL del tracker vive solo en la extensión, en una lista cerrada fijada al compilar;
  - el backend nunca hace de proxy.
- **SSE:**
  - el overlay se autoriza por token, revalidado en cada evento de overlay (si se rota, se
    cierra el stream); el dashboard, por cookie;
  - `Cache-Control: no-store, no-transform`;
  - hay topes concurrentes (SEC-004) y limpieza de presencia con heartbeat y poda.
- **Integridad de sesiones e ingesta:**
  - índice único `(player_id, external_match_id)` con `ON CONFLICT DO NOTHING`, y la asignación
    de sesión se hace con la fila de sesión bloqueada (`FOR UPDATE`);
  - inicio y fin de sesión bloquean al jugador o a la sesión;
  - **tests:**
    - dos workers ingiriendo a la vez (`authorization.test.ts`);
    - dos syncs concurrentes de dos dispositivos de la misma cuenta cuentan cada replay una sola
      vez (`security.test.ts`).
  - las partidas antiguas no entran en la sesión actual (membresía por IDs, con gracia de 90 s);
  - las fechas futuras se rechazan en `/sync`;
  - un snapshot caducado bloquea el inicio de sesión.
- **Base de datos:**
  - Drizzle con `sql` parametrizado; sin `sql.raw` ni identificadores o columnas dinámicos;
  - claves foráneas con `cascade` o `set null` coherentes;
  - las transacciones envuelven ingesta, inicio y fin de sesión, pairing y cambio de CFN;
  - la propiedad solo se aplica en la app (ver SEC-025).
- **Secretos (scan):**
  - ningún `.har`, `.env`, `cfn_session.json`, `debug_output/`, cookie ni token en el árbol **ni
    en el historial**;
  - los `buckler_id=` de los tests son literales falsos (`x`, `v1`, `SECRET-VALUE`);
  - fixtures sin `loginUser`, cookies ni ids de club;
  - `debug_output/`, `.venv`, `dist` de la extensión y el perfil del navegador están en
    `.gitignore`;
  - no hay source maps versionados;
  - ningún secreto usa `NEXT_PUBLIC_`.
  - **Fuera del repo:** los HAR de investigación en `C:\Users\…\Documents\sf6 app\`
    (`buckler-native-2026-10-04.har` contiene cookies de sesión de Buckler) conviene borrarlos o
    guardarlos cifrados.
- **Logging:**
  - el logger redacta claves `token|secret|password|cookie|authorization|apikey` a cualquier
    profundidad y serializa los errores como `{name, message}`;
  - no se registran cabeceras, requests, payloads, códigos de pairing, device tokens ni nombres
    de rivales.
- **Errores:**
  - las rutas del companion devuelven códigos genéricos (`unauthorized`, `invalid_payload`…) y
    solo las rutas del payload inválido, nunca valores;
  - las server actions devuelven mensajes traducidos;
  - Next oculta los stack traces en producción;
  - `/api/health` solo devuelve `{ok}`.
- **Caché:** las páginas autenticadas son `force-dynamic`. `no-store` en `/api/*` y en el
  companion, el overlay y SSE.
- **Extensión MV3 (SEC-021):**
  - permisos mínimos: `storage`, `alarms`, `scripting`, Buckler y orígenes exactos del tracker;
  - sin `externally_connectable` ni content scripts declarados: una web **no puede** enviar
    mensajes al service worker, que además comprueba `sender.id`;
  - sin `eval` (Zod `jitless`), CSP `script-src 'self'`;
  - el script en MAIN world solo hace `fetch` same-origin y devuelve ese JSON (sin
    `document.cookie` ni storage);
  - riesgo residual aceptado: la propia página de Buckler podría falsear lo que ve la extensión,
    pero solo afecta a los datos de esa misma cuenta (SEC-001 impide que vaya más allá).
- **Dependencias (SEC-011):** `pnpm audit` da 1 high y 1 moderate, ambos **solo de desarrollo y
  no alcanzables en runtime**:
  - `braces`, vía `eslint-config-next` → `fast-glob`;
  - `esbuild ≤ 0.24` (servidor de desarrollo), vía `drizzle-kit` → `@esbuild-kit`; no usamos
    `esbuild serve`.

  Se vigila; no hay parche upstream para `braces`.

- **DoS:**
  - topes de body, de partidas y de streams SSE;
  - rate limits distribuidos;
  - Zod sobre ≤ 100 partidas, que es barato;
  - el estado del overlay está limitado por IP;
  - el worker solo reclama jugadores con sesión activa.

## 5. Corregido durante la auditoría

| ID                  | Commit    | Cambio                                                                                                                                     |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-001             | `d6e892c` | Snapshots por cuenta, provider con scope obligatorio, migración 0005                                                                       |
| SEC-002/003/006/013 | `8656efc` | Limiter distribuido (Postgres), Better Auth `database`, IP desde la cabecera de confianza, rechazo del secreto placeholder, migración 0006 |
| SEC-004/005         | `edacc35` | Topes SSE; CSP por superficie, COOP y HSTS                                                                                                 |
| SEC-010 + tests     | `b3083ab` | Revocación por inactividad; regresiones de XSS, SSE, pairing, IDOR e integridad                                                            |

## 6. Riesgos aceptados

- **SEC-007:** token del overlay en la URL.
- **SEC-008:** enumeración en el sign-up.
- **SEC-009:** sin verificación de email ni reset de contraseña.
- **SEC-011:** advisories de herramientas de desarrollo.
- **SEC-015:** sin borrado de cuenta ni retención.
- **SEC-024:** registro abierto.
- **CSP:** `'unsafe-inline'` en `script-src`.
- **Topes SSE:** son por proceso.

## 7. Requisitos de producción (Vercel + Render + Supabase)

| Variable                                                                | Tipo            | Web (Vercel)             | Worker (Render)                   | Notas                                                                                                                                                                            |
| ----------------------------------------------------------------------- | --------------- | ------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                          | **secret**      | ✔                        | ✔                                 | Conexión **directa o session pooler** (5432) con `?sslmode=require`. **No** usar el transaction pooler (6543): rompe `LISTEN/NOTIFY` (SSE) y las sentencias preparadas (SEC-023) |
| `BETTER_AUTH_SECRET`                                                    | **secret**      | ✔                        | ✔ (lo exige la validación de env) | `openssl rand -base64 32`; el placeholder se rechaza                                                                                                                             |
| `RESEND_API_KEY`                                                        | **secret**      | ✔ (web)                  | ✔ (lo exige la validación de env) | Resend, permiso _Sending access_ limitado al dominio; nunca en chat ni en el repo ([auth.md](auth.md))                                                                           |
| `EMAIL_FROM`                                                            | config          | ✔ (web)                  | ✔                                 | remitente en un dominio verificado en Resend (SPF + DKIM; DMARC recomendado)                                                                                                     |
| `APP_URL`                                                               | público         | ✔                        | ✔                                 | `https://…` (activa cookies `Secure`, HSTS y `upgrade-insecure-requests`)                                                                                                        |
| `NODE_ENV`                                                              | público         | `production`             | `production`                      |                                                                                                                                                                                  |
| `TRUST_PROXY`                                                           | público         | `true`                   | —                                 | Imprescindible detrás del proxy de la plataforma                                                                                                                                 |
| `CLIENT_IP_HEADER`                                                      | público         | `x-real-ip`              | —                                 | Cabecera que pone **la plataforma**                                                                                                                                              |
| `RATE_LIMIT_STORE`                                                      | público         | `postgres` (por defecto) | —                                 | No usar `memory` con varias instancias                                                                                                                                           |
| `SF6_PROVIDER`                                                          | público         | `companion`              | `companion`                       |                                                                                                                                                                                  |
| `COMPANION_SNAPSHOT_MAX_AGE_MS`, `PROVIDER_*`, `TRACKER_*`, `LOG_LEVEL` | público         | ✔                        | ✔                                 | Valores por defecto razonables                                                                                                                                                   |
| `ENABLE_DEV_TOOLS`                                                      | —               | **sin definir**          | **sin definir**                   | Inertes en producción en cualquier caso                                                                                                                                          |
| `COMPANION_TRACKER_ORIGINS`                                             | público (build) | —                        | —                                 | Solo al compilar la extensión: `https://tu-dominio`                                                                                                                              |

Ninguna variable usa `NEXT_PUBLIC_`; ningún secreto llega al cliente.

**Base de datos:**

1. **SEC-025:** ejecutar el bloqueo de la Data API (§3) **antes** de exponer el proyecto.
2. **Rol de mínimo privilegio para la app:** DML sobre las tablas, sin `CREATE`, `DROP`,
   superuser ni `BYPASSRLS`. Las migraciones se lanzan con el rol propietario, en un paso de
   despliegue aparte.
3. `pnpm db:migrate` (0000–0006) antes de arrancar la web y el worker.
4. TLS obligatorio (`sslmode=require`).

**Otros:**

- Desplegar con `APP_URL` https; el worker no expone puertos.
- Borrar los HAR con cookies de la máquina de investigación.

## 8. Checklist de retest

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm companion:build`
      (integración con `TEST_DATABASE_URL`).
- [ ] `pnpm audit`: solo los 2 advisories de desarrollo conocidos.
- [ ] Cabeceras en producción:
  - `curl -sI https://<app>/login`: `Content-Security-Policy` con `frame-ancestors 'none'`,
    `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`;
  - `curl -sI https://<app>/overlay/<token>`: CSP con `frame-ancestors *`, sin X-Frame-Options,
    `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- [ ] Supabase: `GET /rest/v1/auth_user` con la clave anon da 401 o 404.
- [ ] Login: el 4.º intento fallido en 10 s da 429, y también desde otra instancia.
- [ ] Overlay: abrir 11 streams de la misma URL; el 11.º da 429. Rotar la URL: los streams
      abiertos reciben `revoked`.
- [ ] Companion:
  - código de pairing reutilizado → `invalid_or_expired_code`;
  - device revocado → 401;
  - `/sync` con `cookies` en el payload → 422;
  - otra cuenta con el mismo CFN no ve mis datos.
- [ ] Extensión de producción compilada con `COMPANION_TRACKER_ORIGINS=https://…`: el manifest
      solo contiene Buckler y ese origen.
