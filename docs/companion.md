# SF6 Session Companion

**Estado: MVP funcionando** (validado en un navegador real el 2026-10-04).

Extensión de navegador (Manifest V3) que lee **tus** datos de Buckler's Boot Camp en **tu
navegador normal**, con tu sesión normal de Buckler. Los normaliza y envía al Session Tracker
solo datos normalizados.

Es **únicamente una fuente de datos**. El backend sigue siendo la autoridad de:

- sesiones;
- W/L y win rate;
- baselines y deltas;
- deduplicación;
- overlays y SSE.

OBS no habla con la extensión.

## 1. Por qué existe

Buckler no se puede consultar desde el servidor:

- **HTTP directo, Playwright headless y Playwright con sesión exportada:** CloudFront responde 403.
- **Login de Capcom bajo automatización:** la verificación de seguridad entra en bucle.

Con el navegador normal del usuario funciona. Por eso la adquisición de datos vive en el
navegador, sin automatizar el login ni evadir nada.

Investigación: `docs/research/2026-10-03-cfn-network-research.md` y `docs/capcom-provider.md`.

## 2. Arquitectura

```
Navegador normal (Chrome / Edge / Brave / Chromium) — login manual en Buckler
   │
   ▼
SF6 Session Companion (apps/companion-extension, MV3)
   ├─ Transporte Buckler   service_worker (preferido) → isolated_tab → main_tab
   ├─ Normalización        @sf6/capcom-core  ← el MISMO código que el provider de servidor
   └─ Cliente del tracker  Bearer device token, credentials: "omit"
   │  POST /api/companion/sync  (solo datos normalizados)
   ▼
Session Tracker (autoritativo)
   ├─ validación estricta, ownership de CFN, límites, rate limit
   ├─ companion_snapshot ──► CompanionSF6DataProvider (SF6_PROVIDER=companion)
   ├─ ingestMatches (dedupe + asignación de sesión bajo lock), sin cambios
   └─ Session Engine → DB → SSE → overlay / OBS
```

- **Lógica compartida:** `packages/sf6-capcom-core` (alias `@sf6/capcom-core`). Contiene
  esquemas, parsers, mapeo de liga y rangos, paginación, buildId/locale, URLs de Buckler y el
  contrato del companion.
  - Solo depende de `zod`; el test `purity.test.ts` lo vigila.
  - Servidor y companion producen exactamente los mismos datos (test de equivalencia).
- **Provider `companion`:** con `SF6_PROVIDER=companion`, iniciar o terminar sesión, el lookup del
  onboarding y el worker usan el último snapshot enviado.
  - Si el snapshot tiene más de `COMPANION_SNAPSHOT_MAX_AGE_MS` (5 min), devuelve `unavailable`.
    Así nunca se arranca una sesión sobre un baseline viejo.
  - `/sync` también ingiere directamente; la ingesta es idempotente.

## 3. Compatibilidad del MVP

| Navegador                                  | Estado                                 |
| ------------------------------------------ | -------------------------------------- |
| Chrome, Edge, Brave, Chromium (MV3, ≥ 120) | Soportado (validado en Brave/Chromium) |
| Firefox                                    | Fuera de alcance (fase futura)         |
| Safari                                     | Fuera de alcance (fase futura)         |

## 4. Transportes hacia Buckler

| Orden | Transporte       | Cómo                                                         | ¿Pestaña de Buckler abierta? |
| ----- | ---------------- | ------------------------------------------------------------ | ---------------------------- |
| 1     | `service_worker` | `fetch` desde el service worker (`credentials: "include"`)   | **No**                       |
| 2     | `isolated_tab`   | `chrome.scripting` en una pestaña de Buckler, mundo ISOLATED | Sí                           |
| 3     | `main_tab`       | `chrome.scripting` en una pestaña de Buckler, mundo MAIN     | Sí                           |

- **Validados:** los tres funcionan en la prueba real. Se usa `service_worker`.
- **Selección:** "Probar conexión con Buckler" prueba en ese orden y guarda el **primero que
  pasa**.
  - En uso normal se detiene ahí, para hacer menos peticiones.
  - En compilaciones debug prueba los tres.
- **Pestaña abierta:** si `service_worker` funciona, no hace falta tener Buckler abierto. Si en
  algún momento fallara y el test eligiera un transporte de pestaña, entonces sí.
- **Sesión:** siempre hace falta una sesión válida de Buckler en ese navegador. La extensión no
  inicia sesión por ti.
- **Peticiones:** son exactamente las del propio sitio, con el **locale de la página**
  (`es-es`, `en`, …) y la cabecera `x-nextjs-data: 1` que envía su router de Next.js:
  - `/_next/data/{buildId}/{locale}/profile/{cfn}/play.json?sid={cfn}`
  - `…/battlelog.json?sid={cfn}` (y `?page=N&sid={cfn}`)
- **buildId y locale:** salen de `__NEXT_DATA__`, se cachean 30 min y, ante un 404, se
  redescubren con un único reintento.
- **Respuestas aceptadas:** 200, o 400 cuyo body pase el esquema completo. Nunca 401, 403, 404,
  429, 3xx ni 5xx.

## 5. Modelo de seguridad

- **Las cookies de Capcom nunca salen del navegador.**
  - La extensión no usa `chrome.cookies` ni lee `document.cookie`.
  - El navegador adjunta su propia sesión a las peticiones a Buckler.
  - No se construye ninguna cabecera `Cookie`.
- **Al tracker solo viajan datos normalizados:**
  - serialización por lista blanca (`toWireMatch`/`toWireProfile`);
  - `findForbiddenKeys` antes de enviar, y el cliente se niega a enviar si encuentra algo;
  - el nivel superior del payload es estricto en el servidor (una clave inesperada → 422).
- **Device token:**
  - 256 bits aleatorios (`sf6c_…`) en `chrome.storage.local`;
  - en la DB solo se guarda su SHA-256;
  - solo sirve para `/api/companion/*` y no es una sesión web;
  - viaja como `Authorization: Bearer` con `credentials: "omit"`.
- **Pairing:** código de 8 caracteres Crockford, un solo uso, TTL de 10 min, guardado como hash.
  Generar otro invalida los anteriores.
- **Revocación:** desde el dashboard (lista de dispositivos) o desde la extensión ("Desconectar").
  Un token revocado recibe 401 y la extensión olvida el pairing.
- **Ownership:**
  - el CFN debe coincidir con el registrado por el usuario (409 `cfn_mismatch`);
  - cada snapshot tiene un dueño por CFN (409 `cfn_owned_by_other`);
  - `play.json` debe ser del CFN pedido.
- **Validación de `/sync`:**
  - esquema completo y `characterKey` como slug;
  - `externalMatchId` obligatorio;
  - `playedAt` entre 2023-06-01 y ahora + 5 min;
  - máximo 100 partidas;
  - body de 256 KB como máximo, **limitado mientras se lee** (413).
- **Rate limit por dispositivo:** 1 sync cada 5 s y 20 `state` por minuto. `pair`: 10 por minuto
  y por IP.
- **CORS** de `/api/companion/*`: `*` **sin** credenciales. La autenticación es solo por Bearer.
- **Logs:**
  - eventos: `companion_paired`, `companion_sync`, `companion_sync_rejected`,
    `companion_device_revoked`, `companion_buckler_error`, `companion_buckler_test`,
    `buckler_non_200_valid_payload`;
  - sin payloads, tokens, cookies ni nombres de rivales.

## 6. Permisos de la extensión

| Permiso                                                       | Motivo                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `host_permissions: https://www.streetfighter.com/6/buckler/*` | `fetch` a Buckler con la sesión del navegador; inyección y búsqueda de pestañas de Buckler |
| `host_permissions: <origen del tracker>/*`                    | `fetch` del service worker a `/api/companion/*`, un permiso por origen permitido           |
| `storage`                                                     | `chrome.storage.local`: device token, estado y caché de IDs                                |
| `alarms`                                                      | Despertar el service worker cada 30 s, sin trucos de keep-alive                            |
| `scripting`                                                   | Transportes `isolated_tab` y `main_tab`                                                    |

- **Sin** `cookies`, `tabs`, `webRequest`, `<all_urls>`, `debugger` ni `optional_host_permissions`.
  CSP `script-src 'self'`, sin `eval` (Zod en modo `jitless`).
- **Orígenes del tracker:** lista cerrada fijada al compilar (`src/lib/tracker-origins.ts`).
  - `pnpm companion:build` incluye `http://localhost:3000` y `http://127.0.0.1:3000`.
  - `COMPANION_TRACKER_ORIGINS=https://tu-tracker.example.com pnpm companion:build:prod` incluye
    solo esos orígenes https.
  - Sin comodines; el popup solo ofrece esos orígenes.

## 7. Datos enviados al tracker

`POST /api/companion/sync`: `{ cfnUserId, observedAt, profile, matches, gapSuspected, client }`.

- **Perfil:** CFN, nombre de luchador, personaje favorito y, por personaje: `characterKey`,
  nombre, rango, `ratingSystem`, LP, MR.
- **Partidas** (solo las que el tracker aún no tiene):
  - `replay_id`, hora (`uploaded_at`), modo, resultado, personaje propio, control;
  - rival: **solo** nombre, personaje y rango si se conoce;
  - `ratingBefore` (LP).
- **Cliente:** versión y transporte.

## 8. Datos que NUNCA se envían

- Cookies, cabeceras `Cookie`, `Authorization` o `Set-Cookie`.
- Tokens de sesión, CSRF/XSRF, `buckler_id`/`buckler_r_id`, contraseñas, access/refresh tokens.
  Están bloqueados por `findForbiddenKeys`, con tests de la lista completa.
- CFN del rival, clubes, comentarios, títulos, likes, redes, emblemas y estadísticas no usadas.
- HTML o JSON en bruto de Buckler.

## 9. Estado del tracker (`GET /api/companion/state`)

Devuelve solo:

- `cfnUserId`, `displayName`, `activeSession`;
- `knownReplayIds` (los últimos 50);
- `ingestEnabled`, `polling` y `serverTime`.

No incluye datos de diagnóstico.

## 10. Polling y recuperación

La configuración central es `COMPANION_POLLING`; el servidor la devuelve en cada `state`.

| Situación         | Buckler                                        | Tracker                |
| ----------------- | ---------------------------------------------- | ---------------------- |
| Sesión activa     | battlelog p1 cada **30 s**, play cada **90 s** | `state` en cada alarma |
| Sin sesión        | battlelog + play cada **120 s**                | `state` cada 30 s      |
| 403 / 429 / login | pausa de 10 min, **sin reintentos**            | sigue                  |

- **Despertar:** `chrome.alarms` (30 s, el mínimo de MV3; no hay trucos para mantener vivo el
  service worker).
- **Estado persistente:** vive en `chrome.storage.local`, así que el navegador cerrado, el PC
  suspendido o el service worker dormido reanudan en la siguiente alarma o en `onStartup`.
- **Recuperación:** tras una pausa larga se recorren como máximo 3 páginas del battlelog hasta
  encontrar un `replay_id` que el tracker ya conoce.
  - Si no aparece, se envía `gapSuspected: true` y se registra; nunca se oculta.
  - Sin IDs conocidos (primera vez) solo se lee la página 1.

## 11. Instalación local

```bash
pnpm install
pnpm db:migrate
pnpm companion:build
```

1. `.env`: `SF6_PROVIDER=companion`, luego `pnpm dev`.
2. `chrome://extensions` (o `edge://`, `brave://`) → **Modo desarrollador** →
   **Cargar descomprimida** → `apps/companion-extension/dist`.
3. Tras cada recompilación, pulsa **⟳** en la página de extensiones.
4. Dashboard u onboarding → **Conectar Companion** → en el popup, elige el tracker, introduce el
   código y pulsa **Conectar**.
5. Con sesión iniciada en Buckler en ese navegador → **Probar conexión con Buckler** → debe
   aparecer:

   ```
   Prueba Buckler: PASS
   Modo: service_worker
   Personajes: 32
   Partidas recientes: 10
   Idioma: es-es
   ```

6. **Sincronizar ahora** → el dashboard muestra tu perfil real → **Iniciar sesión de juego**.

### Diagnóstico (modo debug)

- `pnpm companion:dev`, o `COMPANION_DEBUG=1 pnpm companion:build`.
- El popup muestra además, por transporte:
  - la petición: ruta, `x-nextjs-data`, modos `credentials`/`cache`, ruta del Referer, navegador;
  - la respuesta: tipo, tamaños por clave y `common.statusCode`/`isError`/`loginUser.flg`.
- Todo son metadatos seguros: nunca cuerpos, cookies ni tokens.
- La compilación normal muestra solo el resumen y una razón corta si falla. Los diagnósticos
  quedan igualmente guardados en `chrome.storage.local`.

### Datos demo en desarrollo

- `pnpm db:seed` crea `demo@sf6.local` con el CFN **falso** `1122334455` (proveedor mock).
- El dashboard muestra **DEMO DATA** cuando `SF6_PROVIDER=mock` o cuando la cuenta usa ese CFN.
- Antes de usar el companion con una cuenta demo, reasígnale tu CFN real. El script conserva
  overlays y dispositivos y borra solo sesiones, partidas y ratings del CFN anterior; `--dry-run`
  enseña el inventario antes:

  ```bash
  pnpm dev:reassign-cfn --email demo@sf6.local --cfn <tu CFN> --dry-run
  ```

  ```bash
  pnpm dev:reassign-cfn --email demo@sf6.local --cfn <tu CFN>
  ```

## 11b. Beta distribution

Paquete para testers de la beta cerrada, desde la raíz del repo:

```bash
pnpm companion:package:beta
pnpm companion:inspect:prod
```

Resultado (carpeta `artifacts/`, ignorada por git):

```
artifacts/sf6-session-companion-v<version>-beta.zip      ← manifest.json en la RAÍZ del ZIP
artifacts/sf6-session-companion-v<version>-beta.sha256   ← formato `sha256sum -c`
artifacts/sf6-session-companion-beta.{zip,sha256}         ← mismos bytes, nombre estable (Releases)
```

| Build                                  | Orígenes del tracker (host_permissions)                         |
| -------------------------------------- | --------------------------------------------------------------- |
| **DEV** — `pnpm companion:build`       | `http://localhost:3000`, `http://127.0.0.1:3000`                |
| **PRODUCCIÓN / BETA** — `package:beta` | **solo** `https://sf6-session-tracker-web.onrender.com` (HTTPS) |

- **Origen de la beta:** está en un único sitio, `BETA_TRACKER_ORIGIN` en
  `apps/companion-extension/release/release.ts`. El script fuerza
  `COMPANION_TRACKER_ORIGINS` a ese valor y llama a `pnpm companion:build:prod`. En producción,
  `__SF6_PRODUCTION__` elimina del bundle también los literales de desarrollo (localhost,
  127.0.0.1).
- **Versión:** la fuente de verdad es `version` en `apps/companion-extension/manifest.json`. El
  nombre del ZIP se deriva de ella, y el sufijo `-beta` va solo en el nombre del archivo
  (Chromium solo acepta versiones numéricas). La build inyecta esa misma versión en el bundle
  (`__SF6_COMPANION_VERSION__`): es la que el Companion envía como `client.version` en cada
  sync. Para cada entrega nueva, sube la versión.
- **Validación antes de empaquetar** (si algo falla: no hay ZIP y exit ≠ 0):
  - MV3 y versión válida;
  - `manifest.json`, `background.js`, `popup.{html,js,css}` y `_locales/`;
  - host permissions **exactamente** Buckler + el origen beta;
  - sin `cookies`, `webRequest`, `<all_urls>` ni `content_scripts`;
  - solo archivos esperados: nada de `.env`, `.map`, `.ts`, HAR ni carpetas extra;
  - sin localhost/127.0.0.1, emails, tokens (`sf6c_…`, JWT, Bearer), cabeceras Cookie, claves
    privadas ni `sourceMappingURL`.

  El ZIP generado se vuelve a leer y a validar. Tests: `apps/companion-extension/test/release.test.ts`.

- **ZIP determinista:** fechas fijas y entradas ordenadas, así que el mismo commit en la misma
  máquina da el mismo SHA-256. Entre máquinas puede variar (versión de zlib). La referencia
  para los testers es el `.sha256` que acompaña al ZIP que se entrega.
- **CI manual:** el workflow **Build Companion Beta** (`workflow_dispatch`) genera el ZIP y el
  `.sha256` como artifact de Actions. No crea Releases ni publica nada. GitHub entrega el
  artifact dentro de otro ZIP: hay que extraer primero el ZIP de la beta.
- **Guías:** para testers, [docs/beta/QUICKSTART.md](beta/QUICKSTART.md) y
  [docs/beta/companion-installation.md](beta/companion-installation.md); pasos pendientes de
  Chrome Web Store, [docs/beta/chrome-web-store.md](beta/chrome-web-store.md).

## 11c. Publicar una nueva beta del Companion

Distribución por **GitHub Releases**, sin infraestructura extra. URL estable (siempre la última
beta), la que va en `COMPANION_DOWNLOAD_URL`:

```
https://github.com/SRGarciaVel/sf6-session-tracker/releases/latest/download/sf6-session-companion-beta.zip
```

La primera release (`companion-v0.1.0`) ya está publicada y marcada _Latest_, así que la URL
estable funciona. Sin `COMPANION_DOWNLOAD_URL`, `/help/companion` muestra el aviso de pedir el
ZIP al organizador.

**Pasos para publicar (por ejemplo, v0.1.1):**

1. Sube `version` en `apps/companion-extension/manifest.json` (`0.1.0` → `0.1.1`; solo números).
   Nunca se incrementa sola.
2. Abre un PR con ese cambio (y lo que incluya la versión) y mergéalo en `main`.
3. GitHub → Actions → **Release Companion Beta** → _Run workflow_ en `main`, escribe `publish`
   en `confirm` y, si quieres, notas.
4. Comprueba la release `companion-v0.1.1`: título «SF6 Session Companion v0.1.1 (Beta)», assets
   `sf6-session-companion-beta.zip` y `.sha256`, marcada **Latest**. El último paso del workflow
   ya verifica que la URL estable sirve esa versión.
5. En Render (web service) → Environment: `COMPANION_LATEST_VERSION=0.1.1`. Primera vez también
   `COMPANION_DOWNLOAD_URL` con la URL estable.
6. Redeploy (Render lo hace al guardar variables). Desde ese momento el panel avisa a quien tenga
   una versión anterior.

**Qué hace el workflow** (`.github/workflows/companion-release.yml`, solo `workflow_dispatch`):

- exige `confirm = publish` y ejecutarse desde `main`;
- tests de la extensión, del core compartido y del empaquetado;
- **guardia de versión:** falla si `companion-v<versión>` ya existe (tag o release) o si la
  versión no es mayor que todas las publicadas. Nunca reemplaza assets;
- `pnpm companion:package:beta` + `pnpm companion:inspect:prod`; comprueba que los assets
  estables son el paquete validado;
- `gh release create companion-vX.Y.Z … --latest`, con el SHA-256 y el enlace a la guía en las
  notas;
- comprueba la URL estable.

Permisos: `contents: write` solo en ese job, con el `GITHUB_TOKEN` interno; sin otros secretos.

**Por qué release normal (no prerelease):** GitHub define la release «latest» como la más
reciente que no es prerelease ni borrador, y no permite marcar prereleases como latest
(documentación de la API de Releases, `make_latest`). `releases/latest/download/…` solo
funciona con releases normales, así que se publican como releases normales con «(Beta)» en el
título.

> **Aviso (monorepo):** si algún día se publica otra release en este repo (por ejemplo, de la
> web), créala con `--latest=false` o marca «Set as latest» desactivado. Si no, la URL estable
> apuntaría a esa release, que no tiene el ZIP (404). Si pasara, se arregla marcando de nuevo la
> última `companion-v…` como _Latest_ en GitHub.

**Versión instalada y avisos de actualización:**

- El Companion envía `client.version` en cada sync. El servidor la guarda en
  `companion_device.client_version` (migración `0007`), solo si es una versión Chromium válida y
  ha cambiado.
- El panel usa la del dispositivo con actividad más reciente. Compara numéricamente
  (`compareExtensionVersions`, `@sf6/capcom-core`: `0.1.10 > 0.1.9`) con
  `COMPANION_LATEST_VERSION`:
  - instalada < última → «⚡ Nueva versión disponible» + «Descargar actualización»
    (`COMPANION_DOWNLOAD_URL`) + «Ver cómo actualizar» (`/help/companion#actualizar`);
  - igual → «✓ Companion actualizado»;
  - mayor, desconocida o inválida → solo informa, sin avisos.
- Una versión ≤ 0.1.0 instalada antes de este cambio también se detecta: ya enviaba `0.1.0`.
- Mientras la extensión sea descomprimida, la actualización es **manual**: no hay `update_url`,
  CRX propio ni descargas automáticas.

## 12. Validación manual real — 2026-10-04

Navegador Brave/Chromium normal, sesión de Buckler iniciada a mano, tracker local
(`SF6_PROVIDER=companion`).

| Comprobación                                               | Resultado                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Extensión MV3 cargada                                      | ✔                                                         |
| Pairing extensión ↔ tracker                                | ✔                                                         |
| Transportes `service_worker` / `isolated_tab` / `main_tab` | ✔ los tres (buildId, play.json, battlelog.json)           |
| CFN                                                        | 1733837998                                                |
| Personajes / replays                                       | 32 / 10                                                   |
| Perfil sincronizado en el dashboard                        | TDF \| Comunismo — A.K.I. — Diamond 1 — 19.704 LP         |
| "Iniciar sesión de juego"                                  | sesión creada, baseline correcto, personaje activo A.K.I. |
| Overlay                                                    | conservado y actualizado con los datos correctos          |
| Seguimiento automático                                     | activo                                                    |
| Partida Ranked nueva tras iniciar la sesión                | **pendiente** (smoke test final, §14)                     |

## 13. Limitaciones actuales

- **Navegadores:** solo la familia Chromium (MV3). Firefox y Safari, en una fase futura.
- **Sesión de Buckler:** debe ser válida en ese navegador. Si caduca, el popup lo indica y Buckler
  se pausa 10 minutos.
- **Navegador cerrado:** no hay tracking con el navegador completamente cerrado. Al volver se
  recuperan hasta 30 replays.
- **Cadencia:** `chrome.alarms` la limita a 30 s; no se usan trucos de keep-alive.
- **Baseline:** al pulsar "Iniciar sesión" sin sesión previa, el snapshot puede tener hasta
  ~2 min. Lo mitigan la membresía por IDs y la gracia de 90 s; si tiene más de 5 min, no se puede
  iniciar.
- **Cambio de CFN en modo companion:** desde la UI requiere un snapshot del CFN nuevo. En
  desarrollo, usa `pnpm dev:reassign-cfn`.
- **Rate limiter en memoria** por proceso.
- **Fuera de alcance:** Chrome Web Store, firma, auto-update, instalador y telemetría.
- **Migración:** `0004_companion` solo añade tablas. Para revertirla:

  ```sql
  DROP TABLE companion_snapshot;
  DROP TABLE companion_pairing_code;
  DROP TABLE companion_device;
  ```

  Después, quita la entrada 0004 de `drizzle/meta/_journal.json`.

## 14. Smoke test final pendiente (partida Ranked real)

1. Navegador con el companion y sesión de Buckler iniciada; tracker con `SF6_PROVIDER=companion`
   y OBS con el overlay.
2. Popup → **Probar conexión con Buckler** → PASS. Dashboard → **Iniciar sesión de juego**.
3. Juega **una** partida Ranked con tu personaje.
4. En ≤ 30 s desde que la partida aparece en el battlelog de Buckler: el dashboard y el overlay
   muestran 1 partida con el W/L correcto, el personaje activo correcto y la variación de LP del
   personaje. El popup marca "Última partida: hace … s".
5. Pulsa **Sincronizar ahora** otra vez: no se duplica nada (deduplicación por `replay_id`).
   Después, **Terminar sesión**: el resumen queda congelado.

## Apéndice — historial de problemas resueltos

| Síntoma                                 | Causa                                                                                            | Corrección                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Pairing "Error: network"                | `fetch` invocado como método (`this.fetchImpl(...)`): "Illegal invocation" en el navegador       | Llamada sin `this` y test que emula la regla del navegador; host permissions explícitos del tracker |
| `login_required 400`                    | `/en/` fijo y el texto "must log in" (traducción presente en todas las páginas) usado como señal | Locale de la página y clasificación estructural                                                     |
| 400 con `play` vacío y `statusCode` 400 | La cuenta de desarrollo tenía el CFN **demo** `1122334455`: se pedían datos de otro jugador      | `pnpm dev:reassign-cfn` y aviso DEMO DATA                                                           |

Regresiones cubiertas por tests: `Illegal invocation`, locale, 400 válido/inválido, claves de
credenciales prohibidas y equivalencia servidor/companion.
