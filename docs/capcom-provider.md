# Provider Capcom / Buckler's Boot Camp (prototipo)

> **Estado:** prototipo **desactivado por defecto** (`SF6_PROVIDER=mock`). Está construido
> exclusivamente sobre un HAR capturado a mano desde el navegador el 2026-10-03 (CFN
> `1733837998`) y validado offline con fixtures saneados.
>
> **No se ha demostrado** que un servidor pueda acceder a Buckler: las pruebas automatizadas
> recibieron `403` de CloudFront (ver `docs/research/2026-10-03-cfn-network-research.md`).

Código: `src/server/sf6/providers/capcom/`.

| Archivo            | Responsabilidad                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `client.ts`        | `CapcomBucklerClient`: URLs, cabeceras mínimas, cookies opcionales, buildId, timeout, errores HTTP |
| `build-id.ts`      | `extractBuildId(html)` y `BuildIdCache` (TTL + single-flight)                                      |
| `schemas.ts`       | Esquemas Zod `looseObject`, solo con los campos usados                                             |
| `parse.ts`         | Parsers y normalizadores **puros** (sin HTTP, env ni Next.js)                                      |
| `league.ts`        | `league_info` → `ratingSystem`/LP/MR/rank, solo con evidencia                                      |
| `pagination.ts`    | `collectMatchesSince`: estrategia de `getMatchesSince`                                             |
| `session.ts`       | Sesión humana exportada (Cookie-Editor) → cabecera `cookie`                                        |
| `index.ts`         | `CapcomSF6DataProvider`: `getPlayerProfile`, `getRecentMatches`, `getMatchesSince`, `inspect`      |
| `fixture-fetch.ts` | `fetch` offline sobre los fixtures; solo para tests y `provider:check --fixture`                   |

## 1. Endpoints observados (todos vienen del HAR)

Base: `https://www.streetfighter.com/6/buckler`

| Endpoint                                                                         | Uso en el provider                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /profile/{cfnId}` (HTML, `__NEXT_DATA__`)                                   | Solo para descubrir el `buildId`                                         |
| `GET /_next/data/{buildId}/en/profile/{cfnId}/play.json?sid={cfnId}`             | **Perfil**: `fighter_banner_info` + `play.character_league_infos[]`      |
| `GET /_next/data/{buildId}/en/profile/{cfnId}/battlelog.json?sid={cfnId}`        | **Partidas**, página 1                                                   |
| `GET /_next/data/{buildId}/en/profile/{cfnId}/battlelog.json?page=N&sid={cfnId}` | Página N                                                                 |
| `GET /api/en/card/{cfnId}`                                                       | Parser disponible (`parseCapcomCardPayload`); el provider no lo necesita |

- **Sin usar:** los POST `/api/profile/play/act/*` (characterwinrate, leagueinfo,
  highest/master_rating_info, characterwinratebyrivalcharacter).
  - Hay referencias a ellos en el JS de la página play, pero **no aparecen en el HAR
    capturado**, así que no se modelan.
  - El JS indica que sirven para ver otra temporada (`act`) o modo; los GET ya contienen la
    temporada actual.
- **Rutas existentes no capturadas:** `/battlelog/rank`, `/battlelog/casual`,
  `/battlelog/custom` y `/battlelog/hub` aparecen como enlaces de pestaña en el JS. No se
  usan porque su `_next/data` no se capturó.
- **Cabeceras enviadas por el client:**
  - `accept`;
  - `user-agent` honesto (`sf6-session-tracker (personal stats tool)`);
  - `x-nextjs-data: 1` en `_next/data`, que el propio sitio envía;
  - `cookie` solo si hay sesión.

  No se imita un navegador.

- **Cookies en el HAR:** el HAR se exportó saneado, sin cabecera `cookie`, así que **no
  prueba si los endpoints requieren sesión**.
- **Respuestas:** todas llevan `cache-control: private, no-store`.

## 2. Descubrimiento del buildId

El sitio usa Next.js Pages Router (`__NEXT_DATA__`, `gssp: true`, `__N_SSP` en los JSON). El
`buildId` (`fd-cwVZtHmfmH_deY-WuZ` en el HAR) cambia con cada despliegue de Capcom, así que
**nunca se fija en el código**.

1. `GET /profile/{cfnId}` y se lee `__NEXT_DATA__.buildId`.
2. Si eso falla, se busca en referencias a `/_next/static/{id}/_buildManifest.js` o a
   `/_next/data/{id}/`.
3. Se cachea con TTL (`CAPCOM_BUILD_ID_TTL_MS`, 30 min por defecto) y single-flight.
4. Si un `_next/data` devuelve `404`:
   - se invalida la caché, se redescubre el buildId y se reintenta **una sola vez**;
   - un segundo `404` se trata como `not_found`.

   No hay bucles.

## 3. Cookies y sesión (sin login automatizado)

- La sesión la crea **una persona** iniciando sesión en un navegador normal. Luego la exporta
  con Cookie-Editor (JSON) a un archivo **fuera del repositorio**:
  `CAPCOM_SESSION_FILE=/ruta/absoluta/buckler_session.json`.
- `session.ts`:
  - usa solo cookies de `streetfighter.com` que no hayan caducado;
  - registra en el log únicamente **nombres** (válidas y caducadas), nunca valores;
  - un JSON inválido produce un error que no cita el contenido.
- No hay login, refresco de sesión, Turnstile, stealth, UA falsificado, proxies ni rotación de
  IPs.
- `403`/`401` → `unavailable`, más el log `provider_access_denied` con `path`, `status`,
  `server`, `x-cache` y `withSession`. Nunca incluye cookies.

## 4. Paginación

- **Observado:** `current_page`, `total_page` (10) y 10 replays por página, de más nueva a
  más antigua. La página 1 se pide sin `page`.
- `getRecentMatches` = página 1.
- `getMatchesSince(cfnId, knownReplayIds)` (capability opcional `MatchHistoryCapable`, que el
  worker **todavía no usa**):
  - recorre `page = 1…min(total_page, CAPCOM_MAX_BATTLELOG_PAGES)` (3 por defecto);
  - se para en el primer `replay_id` conocido y solo devuelve los más nuevos.
- **`gapSuspected = true`** si había IDs conocidos pero no se encontró ninguno. Puede ser por
  `page_limit` o por `history_exhausted`. Se devuelve y se registra en el log; nunca se oculta.
- **Avisos sin bucle:**
  - `total_page` incoherente;
  - `current_page` distinto del pedido;
  - página vacía antes de `total_page`.

  Un replay que se desplaza de la página 1 a la 2 durante el sondeo se cuenta una sola vez.

## 5. Mappings (con su evidencia)

### Personaje

- `characterKey` = `character_tool_name` (`aki`, `kimberly`, `chunli`, `vega`, `gouki`…).
- **Nunca se deriva del nombre.** Ejemplo: M. Bison tiene `vega` y Akuma tiene `gouki`.
- Un `character_tool_name` que no sea un slug válido se descarta con aviso; no se deduce otro.
- `characterId` (`character_id`) se conserva en los detalles del provider. El contrato sigue
  usando `characterKey`.
- `Random` (`random`, id 254) tiene su propia entrada de liga, así que se conserva.
- En los replays existe `playing_character_tool_name`, que en el HAR siempre es igual a
  `character_tool_name`. Se guarda en los detalles como `playingCharacterKey`.

### Rating del perfil (`play.character_league_infos[].league_info`)

| Condición                                             | ratingSystem | LP             | MR              | rank / rankTier                        |
| ----------------------------------------------------- | ------------ | -------------- | --------------- | -------------------------------------- |
| `league_point < 0` (−1, siempre con `league_rank` 39) | `null`       | `null`         | `null`          | `null` (sin calificar)                 |
| `master_league >= 36`                                 | `mr`         | `league_point` | `master_rating` | 36 → `Master` / `master`; 37+ → `null` |
| en otro caso                                          | `lp`         | `league_point` | `null`          | etiqueta solo si hay evidencia         |

Evidencia:

- **Master:** la página play de Capcom muestra el MR cuando `master_league>=36`. En el HAR,
  los 9 Master tienen `master_league=36` y `master_rating>0`; el resto, 0/0. No se infiere a
  partir de texto localizado.
- **Etiquetas de rango:** solo se observó `league_rank 31 = "Diamond 1"`. Viene literal de
  `league_rank_info.league_rank_name` y está centralizado en `OBSERVED_LEAGUE_RANK_LABELS`.
  - Además, se usa la etiqueta que trae el propio payload para el personaje favorito.
  - Los rangos 28, 30, 32, 33, 34 y 35 quedan `null`, con su `leagueRankRaw` y un aviso.
  - **No se completó la tabla de memoria.**
- **Sin calificar:** el replay de A.K.I. previo a la colocación tiene −1/39 y el siguiente
  tiene 19000/31.

### Tier de Master mostrado (derivado al leer)

El rank **guardado** sigue siendo el de la normalización: `36 → "Master"`, `37+ → null`. No se
reescribe nada persistido. Lo que se **muestra** se decide al construir el estado en vivo
(`src/domain/sf6/master-tier.ts`, `resolveDisplayRank`). Así el sistema de rating (LP/MR) y el
tier mostrado quedan como conceptos separados.

| MR actual (sistema `mr`, valor > 0) | Tier mostrado   |
| ----------------------------------- | --------------- |
| < 1600                              | Master          |
| 1600–1699                           | High Master     |
| 1700–1799                           | Grand Master    |
| ≥ 1800                              | Ultimate Master |

Fuente: umbrales actuales de la Master League de SF6 documentados por el responsable del
proyecto. Se actualizan en una sola constante (`MASTER_MR_THRESHOLDS`).

- **Legend** no se infiere nunca del MR: depende de la posición en la clasificación global (top
  500). Solo se mostraría con una posición **autoritativa** (`leaderboardPosition` 1…500). SST
  no tiene esa señal hoy: `master_rating_ranking` existe en el payload, pero su significado no
  está probado. Por tanto Legend no aparece.
- **Precedencia del rank mostrado:**
  1. etiqueta de Capcom compatible (hoy no se guarda ninguna para MR);
  2. MR válido → tier derivado;
  3. LP → solo etiquetas con evidencia;
  4. si no, `null`.
- **Solo sesiones activas y estado sin sesión.** Una sesión **terminada** conserva sus
  etiquetas congeladas/guardadas. Los umbrales pueden cambiar entre fases, y una sesión antigua
  no se reetiqueta con las constantes de hoy. Si algún día se quieren tiers históricos
  derivados, deberían usar reglas versionadas por fecha.
- **Consecuencias:** "1605 MR / Rank —" pasa a mostrar **High Master**. Los temas con rango
  usan la familia `high-master` ya existente en `rank-prestige.ts`. Cruzar un umbral en una
  partida real es un cambio de rango legítimo para Creator Motion.

### Temporada / fase

- `current_season_id` (13) y `season_ids` se exponen como `seasonId` en los detalles.
- **`phase` queda en `null`.** No está demostrado que la temporada de Buckler equivalga a la
  fase de MR.

### Partidas (`replay_list[]`)

| Campo del tracker   | Fuente                                                                       | Evidencia                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `externalMatchId`   | `replay_id` (obligatorio)                                                    | Único por revancha (p. ej. `VGPTB9UCN`/`XGSCNHR6N` contra el mismo rival); idéntico entre recargas (dos capturas con el mismo md5) |
| `playedAt`          | `uploaded_at` (segundos Unix) → `Date` UTC                                   | El JS de Capcom hace `dayjs(1e3*uploaded_at)`                                                                                      |
| lado                | `player{1,2}_info.player.short_id === cfnId`                                 | Hay replays reales con el usuario como P2 (`NT4WT4JTE`, `7L8MRU7L5`)                                                               |
| `result`            | rondas ganadas = nº de `round_results > 0`; igual → `draw`                   | Regla copiada del componente battlelog de Capcom (`e[l]>0&&a++`; `e===l?draw:e>l?win:lose`)                                        |
| `mode`              | `replay_battle_type`: `1 → ranked`; el resto → `unknown` + aviso             | 20/20 replays son tipo 1, "Ranked Match"; el nombre solo se usa en logs                                                            |
| `characterKey/Name` | `character_tool_name` / `character_name` del lado propio                     |                                                                                                                                    |
| `opponent`          | `fighter_id`, `character_tool_name`, `character_name`, rank si hay evidencia |                                                                                                                                    |
| `playerControlType` | `battle_input_type 0 → classic`; el resto → `null`                           | Etiqueta `[t]クラシック`                                                                                                           |
| `ratingBefore`      | `league_point` del lado propio (solo LP)                                     | Ver más abajo                                                                                                                      |
| `ratingAfter`       | **`null`**                                                                   | No existe en el payload                                                                                                            |

**`ratingBefore`.** En 19 pares consecutivos de replays de A.K.I.:

- el LP del replay _n_ más el resultado (+55…+72 si gana, −40 si pierde) da el LP del replay
  _n+1_;
- el replay más nuevo (19633, victoria) da el LP actual del perfil (19704);
- la cadena de LP de los rivales es coherente en el mismo sentido.

Por tanto, el valor del replay es el LP **antes** de la partida. Lo comprueba el test "ratingBefore = replay LP".

- **MR por partida:** no se capturó ningún replay en Master, así que el MR queda `null`; el
  valor bruto se guarda en `ratingAtMatchRaw`.
- **Antes de la colocación** (`league_point` −1): `ratingBefore` es `null`.

## 6. Errores

| Caso                                              | Código                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| 404 (perfil, o `_next/data` tras reintentar)      | `not_found`                                                                   |
| 429                                               | `rate_limited` + `retryAfterMs` (`Retry-After` en segundos o como fecha HTTP) |
| timeout / abort                                   | `timeout`                                                                     |
| 403 / 401                                         | `unavailable` + log `provider_access_denied` (**nunca** `not_found`)          |
| 3xx (`redirect: manual`)                          | `unavailable` + log `provider_redirected` (¿sesión caducada?)                 |
| 5xx / error de red                                | `unavailable`                                                                 |
| JSON inválido, payload de otro CFN o esquema roto | `invalid_response`                                                            |

## 7. Huecos abiertos

- **Acceso desde servidor no demostrado** (403 de CloudFront a clientes automatizados). Es el
  bloqueante principal para activar el provider.
- No se sabe si los GET requieren sesión: el HAR se exportó sin cookies.
- Semántica de `uploaded_at`: ¿fin del combate, subida del replay u otra? Sin confirmar; en la
  práctica son de 2 a 3 minutos entre partidas.
- IDs de `replay_battle_type` distintos de 1 (Casual, Battle Hub, Custom Room) y
  `replay_battle_sub_type`: sin evidencia.
- Etiquetas de `league_rank` distintas de 31 y 36; significado de `master_league` 37+.
- MR por partida (antes/después) en Master; `phase` de MR frente a `current_season_id`.
- `battle_input_type` distinto de 0 (Modern, Dynamic).
- Comportamiento de un CFN inexistente (¿404 o payload vacío?) y del `_next/data` con un
  buildId viejo: se asume el 404 estándar de Next.js, **sin observarlo**.
- Ventana de historial (`total_page` 10 × 10 = 100 replays) y orden estable con partidas
  nuevas entrando durante la paginación.

## 8. Qué validar con red real (manual)

1. Desde la red de despliegue: `pnpm provider:check 1733837998` con `SF6_PROVIDER=capcom`,
   **primero sin** `CAPCOM_SESSION_FILE` y después con él. Si da `403` en ambos casos, el
   acceso automatizado no está permitido y el provider no se activa.
2. Confirmar el `404` con un buildId viejo y con un CFN inexistente.
3. Jugar una partida Casual, Battle Hub y Custom Room y anotar su `replay_battle_type`.
4. Con un personaje en Master, comprobar si `master_rating` del replay es el valor antes de la
   partida (la misma prueba de cadena que con el LP).
5. Comprobar `uploaded_at` contra la hora real de fin de partida.

## 9. Modo fixture (offline)

```bash
pnpm provider:check --fixture
```

- Ejecuta el provider Capcom real (client, descubrimiento del buildId, URLs `_next/data`,
  parsers) contra `tests/fixtures/capcom/`, sin red, base de datos ni `.env`.
- Muestra PROFILE, CHARACTERS (con `characterId`, `leagueRankRaw`, `seasonId`), MATCHES (con
  `replay_id`, tipo bruto, lado, rondas, rating en el replay), PAGINATION, los avisos del
  parser y los CHECKS del contrato.

Fixtures (whitelist; sin cabeceras, cookies, traducciones, emblemas, clubes ni títulos):

```bash
python3 scripts/research/make_capcom_fixtures.py "/ruta/al/archivo.har"
```

Genera:

- `card-1733837998.json`
- `play-1733837998.json`
- `battlelog-1733837998-page-{1,2}.json`
- `profile-1733837998.html` (solo el `__NEXT_DATA__` mínimo para el buildId)

**El HAR bruto nunca entra en el repositorio.**

## 10. `provider:check` real (manual, desactivado por defecto)

```bash
SF6_PROVIDER=capcom CAPCOM_SESSION_FILE=/ruta/fuera/del/repo/buckler_session.json pnpm provider:check 1733837998
```

- No cambies `SF6_PROVIDER` en `.env` de forma permanente.
- Ante un `403` o `429`, no repitas: documenta el resultado.
