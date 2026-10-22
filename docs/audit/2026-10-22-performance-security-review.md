# Auditoría de rendimiento, arquitectura y seguridad: SST (2026-10-22)

**Base auditada:** `main` `d63501e` (merge del PR #73, M1 de skeletons; incluye el PR #72 de
consistencia de ratings).

**Naturaleza:** auditoría **de solo lectura sobre el código de producción**. Este PR no cambia
ningún comportamiento de la app. Solo añade:

- este informe;
- evidencias en `docs/audit/2026-10-22-evidence/`;
- herramientas de medición **locales** en `scripts/audit/`.

**Entorno de medición:**

- WSL2 Linux, Node 22, `next build` + `next start` (producción) en `localhost:3171`;
- Postgres local (5433);
- Chromium de Playwright.

**Reglas aplicadas:**

- todas las herramientas rechazan bases de datos o apps que no sean loopback;
- cuentas ficticias `@test.local`, borradas al terminar (0 en la BD de desarrollo);
- Companion simulado por el endpoint real `/api/companion/sync`;
- ninguna petición a producción, Supabase, Render ni Capcom.

> **Límite principal:** la latencia real Render↔Supabase no se midió (no hay acceso a
> producción). Los efectos dependientes del RTT se estiman con un proxy local que añade un RTT
> controlado (40 ms) y se marcan como **«dependiente del RTT»**.

## 0. Respuestas directas

| Pregunta                                   | Respuesta                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. ¿Escrituras una a una?**              | Mayoritariamente **no**: la ingesta (100 partidas = 1 `INSERT … ON CONFLICT`, 6,7 ms), los ratings por personaje y los baselines van en lote. **Excepción medida:** al **finalizar una sesión** se emite un `UPDATE` por personaje con baseline (**19** con un perfil real), dentro de la transacción que bloquea la sesión. Además hay **lecturas duplicadas** por render (jugador, sesión activa, plan y entitlements ×2). |
| **B. ¿Falta feedback optimista?**          | **No es un defecto.** Las acciones que tocan datos de partida, rating, sesión o seguridad esperan correctamente al servidor con estado pendiente. Las seguras (copiar URL, disclosures, vista previa del builder) ya son inmediatas. Solo hay refinamientos menores para M2/M3 (§3.B).                                                                                                                                       |
| **C. ¿Render dinámico innecesario?**       | **No.** Todas las páginas son dinámicas porque dependen de la cookie de sesión o de locale. Las respuestas privadas llevan `private, no-store`. No hay candidatas estáticas sin mover el locale a la URL, y no se recomienda. M1 no añadió coste de servidor.                                                                                                                                                                |
| **D. ¿Dependencias lentas o vulnerables?** | **Sí, una urgente:** `next@16.3.8` está afectado por 3 advisories corregidos en 16.4.1. Uno **aplica directamente** (DoS en Server Actions, HIGH). El RCE del optimizador de imágenes queda **mitigado** por `sharp@0.35.5` fijado en el lockfile. El de `use cache` **no aplica**. Las dependencias de runtime son pocas (10).                                                                                              |
| **E. ¿Peticiones secuenciales?**           | **Sí, en el camino crítico de BD:** el dashboard hace ~25 round trips con unos **17 niveles secuenciales**, y el overlay público unos 15. Con un RTT de 40 ms, el dashboard pasa de 0,16 s a 0,89 s. Son en gran parte dependencias reales, pero hay lecturas duplicadas y un **pool que se enfría a los 30 s** (+370 ms medidos). Dependiente del RTT de producción.                                                        |

**Veredicto de beta ampliada: GO CONDICIONADO** (§16). No hay hallazgos de seguridad críticos
explotables en el código propio. Antes de ampliar hay que actualizar Next (S-01), corregir un
control de disponibilidad (S-02, detalles en el anexo privado) y confirmar los requisitos de
despliegue de Supabase (S-03).

---

## 1. Mapa de arquitectura (estado actual)

```
 Navegador del streamer ── SST Companion 0.4.0 (MV3) lee Buckler ─► POST /api/companion/sync (Bearer device token)
                                                                    GET  /api/companion/state  (~30 s)
 Render (Free, 1 proceso, TRACKER_RUNTIME_MODE=embedded)
   Next 16 App Router ─ páginas RSC (todas dinámicas) · server actions · route handlers
   │  Better Auth (sesión en BD, 2 consultas por getSession) · rate limit en Postgres
   │  Realtime hub: 1 LISTEN sf6_events → SSE /api/me/stream (dashboard) y /api/overlay/<token>/stream (OBS)
   │  Tracker embebido: tick 1 s (claim de leases) · mantenimiento 60 s (auto-fin de sesión)
   └─ postgres.js pool (max 5, idle_timeout 30 s) ──► Supabase Postgres (fuente de verdad)
 OBS Browser Source ── /overlay/<token> (SSR + SSE, layout raíz propio, transparente)
```

**Flujos clave medidos:**

| Flujo                                                                                     | Coste                                                                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Sync del Companion (1 partida + perfil, sesión activa, 1 dashboard + 2 overlays abiertos) | **72 round trips** de BD en total, sumando el fan-out SSE y el `router.refresh` del dashboard |
| Iniciar sesión (clic → LIVE)                                                              | 95 round trips                                                                                |
| Finalizar sesión (confirmar → recap)                                                      | 93 round trips                                                                                |

Detalle en `evidence/requests.json`.

## 2. Herramientas y método (reproducibles)

| Herramienta                          | Qué mide                                                                                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/audit/pg-wire-probe.mjs`    | Proxy TCP del protocolo de Postgres delante de la BD local. Cuenta round trips (Sync o Query) y el texto SQL de cada Parse (nunca los valores Bind). Opcionalmente añade un RTT. Endpoint de control en `:5442`.                                                    |
| `scripts/audit/measure.mts`          | `setup` (3 cuentas y sesiones de 0, 30, 100 y 500 partidas por la UI y el sync reales) · `requests` (round trips y mediana de 5 SSR por página y acción, fan-out, concurrencia) · `idle` (carga en reposo, modo embebido) · `frontend` · `interactions` · `cleanup` |
| `scripts/audit/waterfall.mts`        | Profundidad secuencial: (t con 40 ms − t con 0 ms) / 40 ms                                                                                                                                                                                                          |
| `scripts/audit/explain.mts`          | `EXPLAIN (ANALYZE, BUFFERS)` de las consultas reales sobre 220 844 partidas: objetivo de 20 000 y 100 tenants de ruido. Datos sintéticos borrados al terminar.                                                                                                      |
| `scripts/audit/concurrent-start.mts` | 3 `startSession` concurrentes, **solo contra `TEST_DATABASE_URL`** local                                                                                                                                                                                            |

Cada cifra es **una ejecución** salvo que se indique «mediana de 5». Hay que esperar ±20 % de
ruido en los tiempos locales.

## 3. Las cinco preguntas

### A. Escrituras y consultas

| Operación                                        | Medido                                                                                                                | Valoración                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Ingesta de partidas                              | 100 partidas, 50 duplicadas = **1** `INSERT … ON CONFLICT DO NOTHING` (6,7 ms); un lote de 100 cuesta lo mismo que 1  | ✔ en lote, idempotente (`match_player_external_uq`)                                                      |
| Ratings por personaje                            | 1 upsert multi-fila con guarda `observed_at` (PR #72)                                                                 | ✔                                                                                                        |
| Baselines al iniciar                             | 1 `INSERT` multi-fila                                                                                                 | ✔                                                                                                        |
| **Finales al terminar**                          | **19 `UPDATE session_character_baseline`**, uno por personaje, dentro de la transacción con `FOR UPDATE` de la sesión | ✖ **P-03**. No hay dependencia entre filas, así que un `UPDATE … FROM (VALUES …)` mantiene la semántica. |
| Snapshot del Companion                           | Lectura y escritura bajo lock por cuenta                                                                              | ✔ (necesario: el «presence track» es un fold)                                                            |
| Rate limit                                       | 1 upsert atómico por comprobación + poda                                                                              | ✔                                                                                                        |
| Presencia del overlay                            | 1 `UPDATE` cada 30 s por stream                                                                                       | ✔ barato                                                                                                 |
| **Lecturas duplicadas por render del dashboard** | `sf6_player` ×3, sesión activa ×2, `account_plan` ×2, `entitlement_grant` ×2, `player_character_rating` ×2            | ✖ **P-04** (`evidence/sql-dashboard-analytics.txt`)                                                      |
| Historial del dashboard                          | `select *` de **todas** las partidas de las 10 últimas sesiones en cada render y en cada `router.refresh`             | ✖ **P-06**                                                                                               |

**Planes de consulta** (`evidence/explain.json`, 220 844 partidas):

- Dashboard, recap, LIVE, estado del Companion y claim del worker: **todo por índice, < 0,5 ms**.
- Analíticas a 90 días: bitmap sobre `match_player_played_idx`, 4,6 ms.
- **«Último nombre por personaje» de analíticas:** `Seq Scan` de la tabla completa, **73 ms y
  ~15 000 bloques** de todos los tenants.
- Analíticas «todo el historial»: `Seq Scan`, 53 ms (**P-05**).

### B. Feedback optimista (inventario)

| Acción                 | Hoy                                                                           | Clasificación                                                   | Recomendación / rollback                                         |
| ---------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Iniciar sesión         | Pendiente («Iniciando…»), 1 petición, sin estado local                        | **Debe esperar** (el servidor valida la frescura del Companion) | Mantener                                                         |
| Finalizar sesión       | Dos pasos + pendiente; error visible                                          | **Debe esperar** (congela finales)                              | Mantener                                                         |
| Copiar URL de OBS      | Inmediato («✓ Copiado», ancho estable)                                        | Optimista seguro (local)                                        | —                                                                |
| Guardar overlay        | La vista previa local es inmediata; el estado «guardado» llega tras confirmar | Optimista en la vista previa, confirmación en el guardado       | Si falla: aviso y mantener «sin guardar» (ya lo hace)            |
| Disclosures y pestañas | Nativos, 24–80 ms (`evidence/interactions.json`)                              | Inmediato                                                       | —                                                                |
| Filtros de analíticas  | Navegación con skeleton (M1)                                                  | Pendiente                                                       | M2: `useTransition` para mantener el contenido anterior atenuado |
| Vincular dispositivo   | Código con pendiente; confirmación por SSE                                    | Debe esperar                                                    | —                                                                |
| Revocar dispositivo    | Confirmación + pendiente                                                      | **Debe esperar** (seguridad)                                    | —                                                                |
| Canjear Creator Key    | Pendiente; error genérico                                                     | **Debe esperar** (entitlement)                                  | —                                                                |
| Cambiar idioma         | Pendiente (opacidad) + refresh                                                | Pendiente                                                       | —                                                                |

En estado estable, ninguna interacción supera los 200 ms (máximo 168 ms al desplegar 480 filas
del recap de 500 partidas). Los 400–650 ms de la primera medición coincidían con la hidratación.

### C. Render dinámico

- **Inventario** (salida de `next build`): todas las rutas son `ƒ`, salvo los assets estáticos.
- **Por qué:** `getRequestLocale` lee la cookie `NEXT_LOCALE` y la sesión. Con cookie de
  sesión, incluso `/`, `/help/companion` y `/onboarding` hacen 2–4 round trips de auth. Las
  páginas anónimas (`/`, `/login`) hacen 0 y renderizan en 21–62 ms.
- **Caché:** las páginas llevan `Cache-Control: private, no-cache, no-store, max-age=0,
must-revalidate`; `/api/*` y `/overlay/*` llevan `no-store`; el PDF, `private, no-store`.
  **Correcto.** No hay ningún riesgo de caché compartida de datos privados.
- **Estáticas posibles:** solo moviendo el locale a la URL (`/es`, `/en`), lo que contradice la
  decisión de URLs estables. **No se recomienda:** el beneficio es mínimo (21–62 ms).
- **Fronteras de carga (M1):** sin datos ni auth y sin coste de servidor medible.
- **Hidratación:**
  - **JS por ruta:** dashboard 295 KB gzip (1,07 MB decodificado), analíticas 164 KB, recap
    174 KB, builder 291 KB, overlay de OBS 256 KB, login 162 KB;
  - **long tasks en la carga:** 64–475 ms;
  - **heap:** estable en 10 MB tras 30 s;
  - **CPU en reposo:** 16–77 ms por cada 30 s (`evidence/frontend.json`).

### D. Dependencias

- **Runtime (10):**
  - `next 16.3.8`, `react 19.2.8`, `react-dom`;
  - `better-auth ^1.7.7`, `drizzle-orm ^0.45.3`, `postgres ^3.4.9`;
  - `next-intl ^4.14.9`, `zod ^4.6.5`;
  - `motion ^14` (solo en la landing);
  - `@react-pdf/renderer 4.9.0` (solo en el servidor, en el route handler del PDF).
- **`pnpm audit --prod`:** 2 críticos y 1 alto, todos en `next` (§9: S-01).
- **`pnpm audit` completo:** 12 en total. Los demás son de **desarrollo**:
  - `shell-quote` (crítico, vía `concurrently`);
  - `vite`/`launch-editor` (vía `vitest`);
  - `braces` (vía `eslint-config-next`);
  - `esbuild` (vía `drizzle-kit`).

  No se alcanzan en runtime (S-06).

- **Peso:** el bundle del overlay de OBS incluye **Zod**: el chunk mayor ocupa 108 KB gzip y
  458 KB decodificados, y casi todo es Zod. Llega porque `OverlayView` importa
  `domain/overlay/config` (esquemas a nivel de módulo) (**P-08**). `motion` no llega al
  dashboard ni al overlay. No hay duplicados de React ni de Next.
- **Integraciones lentas:**
  - **PDF de revisión:** 428–639 ms por render (mediana de 5 SSR), bajo demanda;
  - **Capcom:** no se usa en producción (provider `companion`);
  - **arranque en frío de Render:** ~1 min documentado, no medido aquí.

### E. Cascadas y secuencialidad

| Página                  | Round trips | t (0 ms RTT) | t (40 ms RTT) | Niveles secuenciales estimados |
| ----------------------- | ----------- | ------------ | ------------- | ------------------------------ |
| Dashboard Fight Session | 25          | 199 ms       | 891 ms        | ~17                            |
| Dashboard clásico       | 24          | 127 ms       | 807 ms        | ~17                            |
| Overlay público (SSR)   | 10          | 43 ms        | 656 ms        | ~15                            |
| Analíticas              | 6           | 121 ms       | 580 ms        | ~11                            |
| Recap (30)              | 8           | 58 ms        | 526 ms        | ~12                            |
| Builder                 | 18          | 107 ms       | 835 ms        | ~18                            |
| Onboarding              | 4           | 30 ms        | 349 ms        | ~8                             |

**Por qué hay más niveles que round trips:** las aperturas de conexión del pool también cuestan
RTT (**P-01**).

**Cadenas reales:**

1. sesión (`auth_session`), luego usuario (`auth_user`), luego jugador;
2. después, `Promise.all` de 6 lecturas que a su vez encadenan internamente (estado en vivo →
   señales del Companion).

**Paralelizable sin riesgo:** las lecturas duplicadas (**P-04**) y la consulta de jugador del
layout frente a la de la página. Las que dependen del jugador o la sesión **no** deben
paralelizarse a ciegas.

**Sync del Companion:**

- secuencial y bajo locks por diseño: snapshot → ingesta → perfil;
- **no** debe paralelizarse, porque el orden y la guarda `observed_at` son la base de la
  consistencia (PR #72).

## 4. Base de datos

Ver §3.A y `evidence/explain.json`.

**Índices presentes y usados:**

- `match_player_external_uq`, `match_player_played_idx`, `match_session_idx`;
- `game_session_player_started_idx`, `game_session_one_active_uq` (unicidad de sesión activa);
- `overlay_player_idx`, `overlay_connection_overlay_idx`, `sf6_player_next_poll_idx`.

**Pool:** postgres.js con `max: 5`, `idle_timeout: 30`, `fetch_types` por defecto.

- **Medido:** tras 36 s de inactividad, el siguiente render del dashboard reabre **5 conexiones**
  (5 consultas `pg_type`) y tarda **1 186 ms frente a ~810 ms** en caliente (+370 ms con 40 ms
  de RTT, sin TLS; `evidence/pool-cold.json`).
- **En producción:** TLS + SCRAM añaden varios RTT por conexión (**P-01**).
- **En modo embebido**, el pool de 5 conexiones lo comparten las páginas, las acciones, el SSE
  y el tracker (**P-07**).

## 5. Next.js (resumen)

Ver §3.C.

- **Correcto:**
  - `force-dynamic` en todas las páginas autenticadas;
  - cabeceras privadas;
  - auth en el layout antes de las fronteras de carga;
  - `notFound()` tras comprobar la propiedad.
- **Mejorable:** el `router.refresh()` del `LiveDashboardProvider` se dispara con **cada partida
  nueva**, y re-renderiza el RSC completo del dashboard (~25 round trips por dashboard abierto)
  solo para refrescar el historial (**P-02**).

## 6. Dependencias (resumen)

Ver §3.D y S-01 / S-06.

## 7. Cascadas (resumen)

Ver §3.E.

## 8. SSE y Companion

| Aspecto                                    | Evidencia                                                                                                                                                                                                     | Valoración                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Un stream por dashboard                    | Medido en 5.6D, M1 y aquí                                                                                                                                                                                     | ✔                                 |
| Reconexión                                 | El cliente marca «connecting» al cerrarse el stream; el watchdog detecta conexiones medio abiertas a los 45 s; snapshot completo al reconectar                                                                | ✔ (5.6D)                          |
| Fan-out de un sync                         | 72 round trips con 1 dashboard y 2 overlays. El hub construye el snapshot **una vez por jugador**; la mayor parte del coste es el `router.refresh` del dashboard                                              | ✖ P-02                            |
| Concurrencia                               | 3 cuentas sincronizando a la vez durante 45 s con 10 streams de overlay abiertos: 27 syncs, **mediana 69 ms, p95 185 ms**, ~30 round trips por sync                                                           | ✔ en local                        |
| Reposo (modo embebido)                     | **61 round trips/min** sin ninguna sesión activa (claim del tracker cada 1 s); 88/min con un dashboard y un overlay abiertos                                                                                  | P-09 (bajo)                       |
| Backoff del Companion                      | `state` cada ~30 s (6 round trips); sync limitado a 1 cada 5 s por dispositivo (servidor); 120 s fuera de sesión (docs)                                                                                       | ✔                                 |
| Límite de 6 conexiones HTTP/1.1 por origen | **Reproducido:** el 7.º overlay del mismo contexto de navegador no carga (cada SSE ocupa una conexión). OBS (CEF) con muchas fuentes SST, o un dock del dashboard, puede bloquearse si el edge sirve HTTP/1.1 | P-10 (verificar HTTP/2 en Render) |
| Duplicados del sync                        | `ON CONFLICT DO NOTHING` + snapshot fusionado por `externalMatchId`; tests de dos dispositivos concurrentes                                                                                                   | ✔                                 |

## 9. Seguridad

Delta respecto a `docs/security-audit.md` (2026-10-04). Todo lo que se marca PASS se verificó en
el código actual. Para los avisos de Next se dan el advisory y su aplicabilidad, sin
instrucciones de explotación.

| ID   | Hallazgo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Severidad         | Explotabilidad                                          | Evidencia                                                                                                                                          | Corrección                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | `next@16.3.8` dentro de `>=16.0.0 <=16.4.0`. **GHSA-p3m5-59mp-jv5r** (DoS con Server Actions, CVSS 8.2) **aplica**: SST usa Server Actions en 3 módulos, el advisory dice que no hay workaround, y Render ejecuta un solo proceso, así que un DoS deja fuera todo (web, SSE y tracker). **GHSA-2464-fhr4-w9xw** (RCE en el optimizador de imágenes vía `sharp`): `/_next/image` responde aunque SST no use `next/image` (PNG 200, SVG 400 en local), pero el lockfile fija **`sharp@0.35.5`**, que es la mitigación indicada; riesgo residual bajo. **GHSA-673q-mjm6-r5xr** (`use cache`): **no aplica** (sin `use cache`). | **HIGH**          | Red, sin autenticación (según el advisory)              | `pnpm audit --prod`; `grep` de uso; respuesta de `/_next/image`                                                                                    | Subir `next` y `eslint-config-next` a **16.4.1** (mismo major). Opcional: `images.unoptimized: true`, ya que no se usa el optimizador (reduce superficie). Tests y build completos. |
| S-02 | Un endpoint **autenticado y costoso en CPU** carece de un control de disponibilidad (límite de uso o de concurrencia). En el modo de un solo proceso, su uso abusivo degrada al resto de usuarios.                                                                                                                                                                                                                                                                                                                                                                                                                          | **MEDIUM**        | Requiere una cuenta (el registro es abierto)            | Reproducido en local; **detalles, medición y herramienta en el anexo privado entregado al propietario** (no publicados mientras no esté corregido) | Límite por usuario y de concurrencia global, con 429 o 503 + `Retry-After`. Tests.                                                                                                  |
| S-03 | **Requisitos de despliegue** de la auditoría previa: SEC-025 (bloqueo de la Data API de Supabase y RLS), rol de mínimo privilegio, `sslmode=require`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **HIGH si falta** | —                                                       | No verificable desde el repositorio                                                                                                                | Confirmar en producción (checklist del §8 de `security-audit.md`) **antes** de ampliar la beta                                                                                      |
| S-04 | Mutaciones autenticadas sin límite por usuario: guardar overlay, presets, finalizar sesión, analíticas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | LOW               | Cuenta propia                                           | Revisión de `actions.ts`                                                                                                                           | Límites amplios por usuario (p. ej. 60/min) para acotar escrituras y NOTIFY                                                                                                         |
| S-05 | Inicios de sesión concurrentes: la integridad se mantiene (1 activa), pero quedan **sesiones vacías finalizadas** en el historial                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | LOW               | Cuenta propia (la UI ya lo evita con `inFlight`; 6/min) | `evidence/concurrent-start.json`: 3 inicios → 1 activa y 2 vacías                                                                                  | Opcional: si hay una sesión activa iniciada hace < N s, devolverla en lugar de crear otra                                                                                           |
| S-06 | Advisories de **desarrollo** (`shell-quote` crítico vía `concurrently`, `vite`, `braces`, `esbuild`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | LOW               | No en runtime                                           | `pnpm audit`                                                                                                                                       | Actualizar las dev deps en un PR aparte                                                                                                                                             |
| S-07 | El payload público del overlay expone el **UUID de la sesión** y `displayName`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | INFO              | No concede acceso: el recap exige auth y propiedad      | `GET /api/overlay/<token>/state`                                                                                                                   | Aceptable; documentar                                                                                                                                                               |
| S-08 | Documentación desactualizada: §9 de `architecture.md` dice «rate limits in-memory», pero son Postgres (SEC-003)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | INFO              | —                                                       | —                                                                                                                                                  | Corregir el doc                                                                                                                                                                     |

**Verificado (PASS):**

- **Server actions:** todas resuelven la cuenta desde la sesión, validan los UUID y comprueban la
  propiedad (`getOwnedOverlay`, `getOwnedPreset`, `revokeDevice` con `user_id`). Las de desarrollo
  están cerradas por `devToolsEnabled()`.
- **PDF:** sesión obligatoria; solo los datos de la cuenta; `private, no-store`.
- **Heartbeat:** mismo origen, sesión y 6/min.
- **CSRF:** comprobación de Origin de Next y Better Auth (`trustedOrigins`); cookies `SameSite=Lax`
  y `Secure` con https.
- **XSS:** ningún `dangerouslySetInnerHTML`, `innerHTML` ni `eval`.
- **Redirects:** solo a rutas fijas.
- **Cabeceras** (verificadas con `curl`):
  - CSP por superficie, `X-Frame-Options: DENY` y `frame-ancestors 'none'` fuera del overlay;
  - overlay embebible con `no-referrer`, `noindex` y `no-store`;
  - `nosniff`, `Permissions-Policy`, COOP;
  - HSTS cuando `APP_URL` es https.
- **Companion:**
  - `strictObject` en todos los niveles del sync y del pairing;
  - tokens y códigos guardados con hash SHA-256;
  - revocación por inactividad;
  - sync limitado a 1 cada 5 s y state a 20/min por dispositivo;
  - pairing a 10/min por IP con canje atómico.
- **Gate de Fight Session:** decisión solo en el servidor (allowlist); `?ui=classic` solo degrada.
  Verificado en 5.6B–D, M1 y aquí que query, cookie, cabecera y localStorage no conceden acceso.
- **Logs:** sin tokens, cookies, emails ni nombres de rivales en los eventos observados; el logger
  redacta claves sensibles.

## 10. Privacidad

| Dato                                      | Recibido                                               | Persistido                                                  | Expuesto                                                             |
| ----------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Cookies o credenciales de Capcom          | **No** (el `strictObject` rechaza claves desconocidas) | No                                                          | No                                                                   |
| CFN propio, nombre, ratings por personaje | Sí                                                     | Sí                                                          | El dashboard propio; el overlay solo muestra `displayName` y ratings |
| Rivales                                   | Nombre, personaje y rango                              | Nombre, personaje y rango (**sin** CFN id ni payload bruto) | Dashboard y recap propios; **nunca** en analíticas, PDF ni overlay   |
| Replay ID                                 | Sí                                                     | `match.external_match_id` (dedupe)                          | No se expone en el overlay                                           |
| Device tokens                             | —                                                      | Hash SHA-256, por cuenta                                    | —                                                                    |
| Snapshot del Companion                    | Sí                                                     | Por (cuenta, CFN) (SEC-001)                                 | Solo a la cuenta propietaria                                         |

**Riesgos potenciales (no hallazgos):**

- Sin política de retención ni borrado de cuenta (SEC-015, aceptado).
- Los nombres de rivales se guardan indefinidamente. Conviene definir la retención antes de la
  beta abierta.

## 11. Concurrencia y consistencia

- **PR #72 (revisado):**
  - las escrituras de perfil usan la hora de observación;
  - la caché conserva la hora original;
  - el sync invalida solo la entrada de su cuenta.

  Cubierto por 9 tests de integración y una E2E. Sin defectos nuevos.

- **Ingesta:** idempotente, con pertenencia a la sesión bajo lock. Hay tests de dos workers y dos
  dispositivos concurrentes.
- **Inicio:** `FOR UPDATE` del jugador + índice único parcial de sesión activa (S-05 solo afecta
  al historial).
- **Fin:**
  - `FOR UPDATE` de la sesión, idempotente (test de 3 fines concurrentes);
  - las finales salen de la observación más reciente confirmada cuando corre la transacción.
- **Embebido:**
  - leases con `SKIP LOCKED`;
  - al reiniciar, los leases caducan a los 60 s;
  - el auto-fin se reevalúa bajo lock.
- **No se reescribió nada:** ningún defecto reproducido en esta área, salvo S-05 (cosmético).

## 12. Mediciones (resumen)

Ver `evidence/*.json`. Valores principales:

- **SSR, mediana de 5:**
  - dashboard Fight Session 140 ms (25 round trips) y clásico 106 ms (24);
  - analíticas 108–128 ms (6);
  - recap 39, 55, 153 y 252 ms (0, 30, 100 y 500 partidas, 7–8 round trips);
  - builder 100 ms (18);
  - overlay 77 ms (10);
  - PDF 639 ms (5).
- **Sync del Companion:** mediana de 69 ms y p95 de 185 ms con 3 cuentas y 10 overlays.
- **Interacciones estables:** 24–168 ms.
- **CLS:** < 0,01 en LIVE (5.6D); el builder tiene 0,054 propio (M1).
- **Heap estable** y CPU en reposo baja.

## 13. Matriz de severidad

| ID         | Categoría                  | Severidad                                | Impacto en el usuario                                       | Evidencia                                   | Corrección                                                                                                 | Beneficio esperado             | Riesgo de regresión                               | Esfuerzo | PR           |
| ---------- | -------------------------- | ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------- | -------- | ------------ |
| S-01       | Seguridad (dependencia)    | **HIGH**                                 | Caída total del proceso por DoS                             | `pnpm audit`, uso de Server Actions         | `next` 16.4.1                                                                                              | Cierra 3 advisories            | Bajo-medio (minor de Next; suite completa)        | S        | PR-1         |
| S-02       | Seguridad / disponibilidad | **MEDIUM**                               | Degradación para todos los usuarios del proceso             | Anexo privado                               | Límite de uso + concurrencia                                                                               | Acota el abuso                 | Bajo                                              | S        | PR-2         |
| S-03       | Despliegue                 | HIGH si falta                            | Exposición de tablas                                        | Requisito previo                            | Verificación operativa                                                                                     | —                              | —                                                 | S        | Ops          |
| P-01       | Rendimiento (BD)           | **MEDIUM** (depende del RTT)             | +370 ms (local) en la 1.ª vista tras 30 s                   | `pool-cold.json`                            | `idle_timeout` mayor (p. ej. 300 s); valorar `fetch_types: false` si no hay columnas array                 | Menos reconexiones TLS y SCRAM | Bajo (vigilar los límites del pooler de Supabase) | S        | PR-3         |
| P-02       | Rendimiento (realtime)     | **MEDIUM**                               | ~25 round trips por partida y dashboard abierto             | `requests.json` (72 round trips por sync)   | Refrescar solo al cambiar el estado de la sesión, o mover «última sesión» e historial a un segmento ligero | −60–70 % de BD por partida     | Medio (el historial debe seguir actualizado)      | M        | PR-5         |
| P-03       | Rendimiento (escritura)    | **MEDIUM** (depende del RTT)             | Fin de sesión más lento y lock más largo                    | 19 `UPDATE` (`requests.json`)               | `UPDATE … FROM (VALUES …)` en una sentencia                                                                | −18 round trips bajo lock      | Bajo (tests de finales: PR #72)                   | S        | PR-3         |
| P-04       | Rendimiento (lecturas)     | LOW                                      | 5–7 round trips por render                                  | `sql-dashboard-analytics.txt`               | `cache()` de React para jugador, sesión activa y plan/entitlements                                         | −20–25 % de round trips        | Bajo                                              | S        | PR-4         |
| P-05       | Rendimiento (analíticas)   | LOW–MEDIUM (crece con el volumen global) | Analíticas más lentas para usuarios grandes                 | `explain.json` (seq scan, 73 ms)            | Nombres desde `player_character_rating` (sin migración)                                                    | Elimina el seq scan por carga  | Bajo                                              | S        | PR-4         |
| P-06       | Rendimiento (historial)    | LOW                                      | Render proporcional a las partidas de 10 sesiones           | `explain.json`, SSR 252 ms del recap de 500 | Proyección mínima de columnas; memoizar resúmenes de sesiones **terminadas** (inmutables)                  | Menos I/O y CPU                | Bajo-medio                                        | S–M      | PR-4         |
| P-07       | Capacidad                  | LOW                                      | Contención con carga (pool de 5 compartido)                 | Configuración                               | Pool separado para el tracker embebido, o pasar a split al crecer                                          | —                              | Bajo                                              | S        | Más adelante |
| P-08       | Frontend (OBS)             | LOW                                      | Más JS en cada fuente de OBS                                | Chunk de 108 KB gzip con Zod                | Separar tipos y defaults de los esquemas en el cliente del overlay                                         | −~100 KB gzip                  | Medio (sin tocar el render del overlay)           | M        | PR-6         |
| P-09       | Eficiencia                 | LOW                                      | 86 400 consultas/día en reposo                              | `idle.json`                                 | Despertar el tracker con NOTIFY de inicio de sesión y espaciar el tick si no hay sesiones                  | Menos carga en Supabase        | Medio                                             | M        | Más adelante |
| P-10       | Compatibilidad OBS         | INFO→MEDIUM si HTTP/1.1                  | > 5 fuentes SST en un CEF pueden bloquearse                 | Reproducido en local                        | Verificar HTTP/2 en el edge de Render; documentar el límite                                                | —                              | —                                                 | S        | Ops          |
| P-11       | Recap largo                | LOW                                      | 4 285 nodos y 252 ms con 500 partidas                       | `frontend.json`                             | Renderizar las partidas antiguas al desplegar                                                              | Menos DOM                      | Bajo                                              | S        | M4           |
| P-12       | Auth                       | INFO                                     | 2 consultas por petición (`getSession` sin caché de cookie) | `requests.json`                             | Valorar `cookieCache` con `maxAge` corto (compromiso: retraso en la revocación)                            | Menos round trips              | **Seguridad**: decidir explícitamente             | S        | Diferido     |
| S-04       | Seguridad                  | LOW                                      | Amplificación de escrituras                                 | Revisión                                    | Límites por usuario                                                                                        | —                              | Bajo                                              | S        | PR-2         |
| S-05       | Consistencia               | LOW                                      | Sesiones vacías en el historial                             | `concurrent-start.json`                     | Idempotencia de inicio por ventana corta                                                                   | —                              | Bajo                                              | S        | PR-7         |
| S-06       | Dev deps                   | LOW                                      | Ninguno en runtime                                          | `pnpm audit`                                | Actualizar las dev deps                                                                                    | —                              | Bajo                                              | S        | PR-7         |
| S-07, S-08 | Info                       | INFO                                     | —                                                           | —                                           | Documentar / corregir docs                                                                                 | —                              | —                                                 | XS       | PR-7         |

## 14. Evidencias y limitaciones

- **Evidencias:** `docs/audit/2026-10-22-evidence/`:
  - `requests.json`, `waterfall-0ms.json`, `waterfall-40ms.json`;
  - `explain.json`, `idle.json`, `frontend.json`, `interactions.json`;
  - `pool-cold.json`, `concurrent-start.json`;
  - `sql-dashboard-analytics.txt` (solo texto SQL, sin parámetros ni datos).
- **Sin producción:** no se midió el RTT real Render↔Supabase, la CPU de Render Free ni el
  arranque en frío.
- **Una ejecución por cifra.** El dataset sintético no reproduce la distribución real de datos.
- **Sin pruebas ofensivas de los advisories de Next:** la aplicabilidad se basa en los
  advisories públicos y en el uso del código.
- **Supabase (S-03):** sus requisitos no se pueden verificar desde el repositorio.
- **BD de test:** contiene 65 cuentas `@test.local` de ejecuciones anteriores de los tests de
  integración, no de esta auditoría. No se han tocado.

## 15. Plan priorizado

### Correcciones inmediatas de seguridad y corrección (antes de ampliar la beta)

1. **PR-1:** `next` y `eslint-config-next` a 16.4.1 (S-01). Opcional: `images.unoptimized`.
   Hay que pasar suite completa, build y la E2E de 5.6D / M1.
2. **PR-2:** control de disponibilidad de S-02 (según el anexo privado) y límites amplios por
   usuario en las mutaciones (S-04), con tests de integración.
3. **Operativo:** confirmar S-03 (Supabase), HTTP/2 en Render (P-10) y la región y el RTT
   Render↔Supabase (condiciona P-01 y P-03).

### Rendimiento respaldado por mediciones

4. **PR-3:** `idle_timeout` del pool (P-01) y finales en un solo `UPDATE` (P-03). Medir de nuevo
   con `waterfall.mts` y `measure.mts requests`.
5. **PR-4:** deduplicar lecturas (P-04), nombres de personaje en analíticas (P-05) y proyección
   del historial (P-06).
6. **PR-5:** acotar `router.refresh` por partida (P-02). Necesita una E2E del historial en LIVE.

### Interacción frontend (M2/M3/M4)

7. Mantener el contenido anterior atenuado en los filtros de analíticas (M2).
8. Recap largo bajo demanda (M4, P-11).
9. **PR-6:** sin Zod en el cliente del overlay (P-08), verificando que el render en OBS no cambia.

### Diferido o especulativo (requiere más evidencia)

- `cookieCache` de Better Auth (P-12; decisión de seguridad).
- Tracker con despertar por NOTIFY (P-09).
- Pool separado o modo split (P-07): cuando el tráfico lo justifique.
- Idempotencia de inicio (S-05) y dev deps (S-06): **PR-7** junto con los documentos (S-07, S-08).

## 16. Recomendación de beta ampliada

**GO CONDICIONADO** para ampliar la beta **de forma controlada** (más streamers en la allowlist,
pocos a la vez), **cuando**:

1. **S-01 corregido:** Next 16.4.1 desplegado.
2. **S-02 corregido** (anexo privado).
3. **S-03 confirmado en producción:** Data API de Supabase bloqueada, rol mínimo y TLS.
4. **RTT y HTTP/2 verificados en producción.**
   - Si el RTT es ≥ 30 ms, aplicar PR-3 antes de crecer: el dashboard tiene ~17 niveles
     secuenciales y un pool que se enfría.

**NO-GO** para un lanzamiento global o de registro abierto masivo **sin**:

- PR-3, PR-4 y PR-5;
- una política de retención de datos (SEC-015);
- revisar el modo embebido de un solo proceso (P-07).
