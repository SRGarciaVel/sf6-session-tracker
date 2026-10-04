# Investigación de red — Buckler's Boot Camp / CFN (2026-10-03)

> **Actualización:** las fases 3–9 se resolvieron después con un HAR capturado a mano desde el
> navegador. Ver `docs/capcom-provider.md`. Lo que sigue documenta el bloqueo de las pruebas
> automatizadas, que sigue vigente.

> **Estado: BLOQUEADA en la fase 2.** Toda petición al sitio desde este entorno recibe
> `403` de CloudFront antes de llegar a la aplicación. No se ha observado ningún payload
> real. Nada de este documento describe endpoints internos verificados: lo que no se ha
> visto se marca **NO VERIFICADO**.

## Alcance y política aplicada

- Solo el CFN de prueba `1733837998`, 3 URLs y un máximo de 1 petición por herramienta.
- Chromium headless sin modificar: sin `playwright_stealth`, sin ocultar
  `AutomationControlled` y sin UA falsificado. `httpx` con sus cabeceras por defecto.
- La sesión es la exportación humana existente (`tdf-edeportes/backend/cfn_session.json`,
  configurable con `CFN_SESSION_FILE`). Los valores de las cookies no se imprimen ni se
  guardan.
- Al primer `403` las herramientas paran y no reintentan.
- `debug_output/` y `scripts/research/.venv` están en `.gitignore`.

## Herramientas (`scripts/research/`, separadas del provider de producción)

| Archivo                  | Función                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cfn_session.py`         | Carga la sesión como `cfn_scraper.py` (mapeo `sameSite`). Informe solo con nombres y caducidad. Redacción de cabeceras y JSON.                                                                          |
| `inspect_cfn_network.py` | Visita profile → battlelog → `/en/.../play`. Registra document, fetch, XHR, JSON y `_next/data`. Extrae `__NEXT_DATA__` y detecta RSC (`self.__next_f`). Escribe en `debug_output/network/` ya saneado. |
| `test_cfn_http.py`       | Reproduce las páginas por HTTP plano. Detecta `buildId` y `__NEXT_DATA__`. Admite `--runs N` y `--no-cookies`.                                                                                          |
| `benchmark.py`           | Playwright frente a HTTP, N ejecuciones con 3 s entre peticiones. Se detiene ante 403/429.                                                                                                              |

Configuración:

```bash
python3 -m venv scripts/research/.venv
scripts/research/.venv/bin/pip install playwright httpx
```

## Evidencia obtenida

### 1. Sesión existente: caducada

| Cookie         | httpOnly | Caducidad     |
| -------------- | -------- | ------------- |
| `buckler_r_id` | no       | hace 8,3 días |
| `buckler_id`   | sí       | hace 8,3 días |

Aunque no hubiera bloqueo, las fases autenticadas (battlelog y la pestaña play) necesitan
una exportación nueva hecha a mano.

### 2. Bloqueo en el borde (CloudFront), antes de autenticar

| Cliente                                         | URL                   | Resultado                                                      |
| ----------------------------------------------- | --------------------- | -------------------------------------------------------------- |
| Chromium headless (sin cookies, `--no-cookies`) | `/profile/1733837998` | `403`, 919 B, `x-cache: Error from cloudfront`, POP `MIA50-P9` |
| `httpx` por defecto (sin cookies)               | `/profile/1733837998` | `403`, 919 B, misma firma                                      |

- La respuesta la genera CloudFront (`server: CloudFront`, `x-cache: Error from cloudfront`).
  No es la aplicación Next.js: no llega HTML de Buckler, ni `__NEXT_DATA__`, ni `buildId`.
- No es un desafío de Turnstile ni una página de login: es una denegación seca de WAF o de
  geo/IP.
- El scraper existente de tdf funcionaba con `playwright_stealth`, un UA de Chrome 131
  falsificado y sin el flag de automatización. Eso apunta a que la regla de borde filtra
  firmas de cliente automatizado (UA `HeadlessChrome`, UA no-navegador, reputación de IP) y
  no a la sesión.
- **No se ha probado a cambiar UA ni a usar stealth para confirmarlo**: eso sería justo la
  evasión prohibida.

## Respuestas a las fases 3–11

Ninguna está verificada; todas dependen de pasar el borde con tráfico legítimo.

| Fase | Pregunta                 | Estado                                                                                                                                                      |
| ---- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | ID real de partida       | NO VERIFICADO. El scraper actual no encontró ninguno en el DOM y deduplica por `(cfn, played_at, rival)`, que no distingue rematches del mismo minuto.      |
| 4    | Perfil por personaje     | El DOM tiene nombre de personaje y LP/MR por bloque (`character_name__`, `character_point__`). Fuente: scraper. Se desconoce si existe un ID numérico.      |
| 5    | Mecanismo Next.js        | NO VERIFICADO. Las clases `*__hash` sugieren CSS Modules de Next, sin distinguir entre Pages Router (`__NEXT_DATA__`) y App Router (RSC).                   |
| 6    | Paginación del battlelog | NO VERIFICADO. El scraper solo lee la primera página.                                                                                                       |
| 7    | Timestamps               | DOM: `MM/DD/YYYY HH:MM` sin zona horaria. El scraper supone UTC−4 por observación empírica. Sin segundos, así que dos partidas del mismo minuto colisionan. |
| 8    | Modo                     | NO VERIFICADO como enum. El battlelog tiene pestañas por modo en el DOM.                                                                                    |
| 9    | Rating antes/después     | No en el DOM conocido. El scraper no lo extrae.                                                                                                             |
| 10   | Reproducción HTTP        | Bloqueada en el borde (403) con cliente no-navegador.                                                                                                       |
| 11   | Benchmark                | No ejecutable (403). Script listo.                                                                                                                          |

## Mapeo de campos (provisional, solo con evidencia del scraper existente)

| Campo del tracker              | Fuente encontrada                                                       | Fiabilidad                         |
| ------------------------------ | ----------------------------------------------------------------------- | ---------------------------------- |
| `cfnUserId`                    | URL `/profile/{id}`                                                     | Alta                               |
| `displayName`                  | DOM del perfil                                                          | Media (selector con hash)          |
| `characters[].characterName`   | `[class*=character_name__] span`                                        | Media                              |
| `characters[].characterKey`    | Derivable del nombre (slug)                                             | Media; sin ID oficial              |
| `leaguePoints` / `masterRate`  | `character_point__` + `master_league__`/`normal_league__`; texto "X MR" | Media                              |
| `rank` / `rankTier`            | Imagen; no se extrae                                                    | Baja; derivable de LP por umbrales |
| `externalMatchId`              | —                                                                       | **Ninguna**                        |
| `playedAt`                     | Texto de fecha, al minuto, zona supuesta                                | Baja                               |
| `mode`                         | Pestaña del battlelog                                                   | Media                              |
| `result`                       | Clase `battle_data_win__`/`lose__`                                      | Media                              |
| `characterKey` de la partida   | `alt` de la imagen                                                      | Media                              |
| `opponent.name`                | DOM; CFN del rival vía modal                                            | Media                              |
| `ratingBefore` / `ratingAfter` | —                                                                       | **Ninguna**                        |

## Huecos

| Hueco                              | Clase                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Acceso al sitio (403 de borde)     | **BLOQUEANTE**                                                                                                                           |
| Sesión caducada                    | **BLOQUEANTE** (requiere paso humano)                                                                                                    |
| `externalMatchId` estable          | BLOQUEANTE para la deduplicación robusta. NEEDS FALLBACK: hash `(cfn, playedAt, rival, personajes, resultado, índice dentro del minuto)` |
| `ratingBefore`/`After` por partida | NO BLOQUEANTE / CAN DERIVE: el tracker ya funciona con snapshots de perfil por personaje                                                 |
| `rankTier`                         | CAN DERIVE desde LP                                                                                                                      |
| Paginación                         | NO BLOQUEANTE para sesiones en vivo (la primera página basta con polling frecuente). NEEDS FALLBACK para backfill                        |
| Zona horaria / segundos            | NEEDS FALLBACK: membresía por IDs, `playedAt` solo como secundario (ya implementado, gracia de 90 s)                                     |

## Arquitectura recomendada (provisional)

Hoy solo hay evidencia para descartar la **reproducción HTTP directa** desde este entorno. La
opción realista es la **C/D: Playwright con sesión humana**.

Supuestos:

- Un worker aislado carga la página con una sesión exportada a mano.
- Lee el payload estructurado si existe (`__NEXT_DATA__`/RSC) y, si no, el DOM.
- Normaliza en el provider `capcom` detrás del contrato existente y del `provider:check`.

Esto solo es viable si el acceso es legítimo desde la red de despliegue. **No se va a
diseñar sobre stealth ni UA falsificado**: si el borde de Capcom solo deja pasar clientes
camuflados, la integración es frágil por definición y debe tratarse como no soportada.

## Siguiente paso (requiere acción humana)

1. Iniciar sesión a mano en Buckler en el navegador habitual y exportar de nuevo las cookies
   con Cookie-Editor a `tdf-edeportes/backend/cfn_session.json`.
2. Investigación desde el **propio navegador**, sin automatización, que es la vía que no
   choca con el WAF:
   - DevTools → Network en las 3 URLs, filtro Fetch/XHR + Doc.
   - Exportar el HAR **sin contenido sensible** a `debug_output/network/manual.har`.
   - Comprobar en la consola: `document.getElementById('__NEXT_DATA__')`, `self.__next_f`,
     `next.router`.
3. Con el HAR, se puede analizar todo offline (ID de partida, paginación, timestamps, enum
   de modo, rating por partida) sin volver a tocar el sitio.
4. Comprobar si el 403 depende de la IP: ejecutar `inspect_cfn_network.py` una vez desde la
   red donde correrá el worker. Si da 403, el acceso automatizado no está permitido allí.

## Prueba de navegador persistente (2026-10-04)

Herramienta: `scripts/research/test_persistent_browser.ts`.

```bash
pnpm research:cfn-browser --login
pnpm research:cfn-browser --login-plain
pnpm research:cfn-browser --check
pnpm research:cfn-browser --check-headless
```

- **Configuración:**
  - Chromium 1243 de Playwright (`channel: "chromium"`), con interfaz vía WSLg.
  - Perfil dedicado `~/.sf6-buckler-browser-profile`, fuera del repo.
  - Sin stealth, sin flags extra, sin UA propio.
- **`--login` (Chromium controlado por Playwright):**
  - La portada de Buckler carga.
  - El login en `auth.cid.capcom.com` entra en bucle en "Performing security verification":
    al pulsar "Verify you are human" vuelve a la misma página. La persona no pudo completar
    el login.
  - Se detuvo la prueba, sin reintentos ni evasión.
- **`--check` visible, una sola carga, sin sesión:**
  - `/profile/1733837998` devuelve `403` con `x-cache: Error from cloudfront`.
  - Pero el cuerpo es **la aplicación de Buckler**: título "Profile | Buckler's Boot Camp",
    `__NEXT_DATA__` presente, `buildId` `fd-cwVZtHmfmH_deY-WuZ`, página `/profile/[sid]` y el
    texto "must log in".
  - Es el 403 de "requiere login" de la propia app, **no** el bloqueo WAF de 919 B que
    recibieron headless y `httpx`.
  - CFN en datos estructurados: no (no hay sesión).
- **No probados:** `--check-headless` y `play.json`/`battlelog.json` desde el contexto. Se
  omitieron porque `--check` visible no tuvo sesión válida.
- **Clasificación: E — SESSION_NOT_VALID.**
  - El borde deja pasar Chromium visible controlado por Playwright.
  - Lo que falla es la verificación de seguridad del login de Capcom ID bajo automatización.
- **Siguiente intento permitido:** `--login-plain`.
  - Abre el mismo binario y el mismo perfil **sin** Playwright, para que la persona inicie
    sesión de forma normal.
  - Después, `--check` una vez.
