# Auditoría técnica — SF6 Session Tracker (2026-10-03)

> **Estado de seguimiento:**
>
> - **Resueltos:** F-01, F-02, F-03, F-05, F-07 y P0-1, P0-2, P0-3 (modelo de rating por
>   personaje, pertenencia a la sesión por ID con 90 s de gracia, `provider:check` ampliado).
>   Detalles en `docs/architecture.md` §3–§5.
> - **Pendientes:** el resto de prioridades.

Alcance: modelo multi-personaje, integración CFN real, autenticación/cuentas, robustez de
producción y cobertura de tests. **Sin cambios estructurales.** Solo se añadió un test de
auditoría de lectura (`tests/integration/authorization.test.ts`).

Estado verificado al cerrar la auditoría: `pnpm typecheck` ✓ · `pnpm lint` ✓ ·
`pnpm test` ✓ (94 tests, 11 ficheros) · `pnpm build` ✓.

---

## 0. Respuestas directas

| Pregunta                                     | Respuesta                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿El modelo soporta múltiples personajes?     | **No.** El W/L sí funciona, pero el rating (rank, LP y MR) es global por jugador y por sesión. Reproduje un delta falso de **−8560 LP** y un falso "Master → Diamond 3" al cambiar de A.K.I. a Kimberly (§1.2).                                                                                                      |
| ¿Qué debe entregar el extractor?             | Un perfil con **ratings por personaje**, y partidas con una **clave estable de personaje**, un timestamp absoluto, el modo y, a ser posible, el rating tras la partida (§2.3).                                                                                                                                       |
| ¿Qué falta en autenticación para producción? | Verificación de email, reset de contraseña, rate limiting compartido, una **IP de cliente correctamente resuelta tras el proxy**, y rechazar el secreto de ejemplo (§3).                                                                                                                                             |
| ¿Qué riesgos hay en worker y realtime?       | La consistencia es sólida (idempotencia, leases y SSE con estado completo). Los riesgos reales son: **no hay presupuesto global de llamadas a CFN**, si el worker está caído más de una página de historial se pierden partidas, y la pertenencia a la sesión depende de la precisión de los timestamps de CFN (§4). |
| ¿Qué corregir primero?                       | El modelo de rating por personaje y el contrato del provider. Después validar los timestamps reales, y luego la configuración de autenticación (§6, P0).                                                                                                                                                             |

---

## 1. Modelo multi-personaje

### Hallazgos

**F-01 · CRITICAL · Session Domain — el rating es global por jugador**

- **Finding:** rank, LP y MR existen una sola vez por jugador y una sola vez por sesión.
  - El delta se calcula como `current − initial`, sin saber de qué personaje es cada valor.
- **Impact:** al cambiar de personaje se producen deltas y rangos falsos en el panel, en el overlay
  (en directo en el stream) y en el historial. Si en cambio el perfil sigue devolviendo el
  personaje principal, el progreso del resto de personajes se pierde.
- **Evidence:**
  - `sf6_player.rank / league_points / master_rate` y `game_session.initial_* / final_*` en
    `src/server/db/schema.ts`.
  - `NormalizedPlayerProfile` tiene un único `rank / leaguePoints / masterRate`
    (`src/domain/sf6/types.ts`).
  - `buildRatingView(initial, current)` (`src/domain/sf6/rating.ts`), usado desde
    `summarizeSession` (`src/domain/session/engine.ts`).
  - `sessionCurrentRating` (`src/server/sessions/mappers.ts`).
  - El experimento de §1.2.
- **Recommendation:** baseline y rating actual **por personaje** (§1.3).

**F-02 · HIGH · Session Domain / Provider — el baseline de otros personajes es irrecuperable**

- **Finding:** al iniciar la sesión solo se guarda un snapshot. Si después se juega con Kimberly,
  su LP inicial no está guardado en ningún sitio.
  - `match.league_points_after / master_rate_after` existe, pero no hay valor "antes", y el
    contrato no garantiza "después".
- **Impact:** la pérdida de datos no se puede reconstruir a posteriori para las sesiones ya
  jugadas.
- **Evidence:** `startSession` (`src/server/sessions/service.ts`) guarda `initial*` desde un único
  `profile`. `RatingAfterMatch` es opcional.
- **Recommendation:** el provider debe devolver los ratings **de todos los personajes** al iniciar
  la sesión, y/o `ratingBefore` y `ratingAfter` por partida.

**F-03 · MEDIUM · UI/Overlay — un único "rating principal"**

- **Finding:** el sistema (MR o LP) se elige a partir del snapshot actual con
  `resolveRatingSystem`. El header muestra un rango global.
- **Impact:** aunque se arregle F-01, la UI necesita el concepto de **personaje activo** y un
  desglose por personaje.
- **Evidence:** `ratingParts` (`OverlayView.tsx`), `PlayerHeader` y `SessionPanel`
  (`SessionPanel.tsx`).
- **Recommendation:** §1.3, punto 5.

**F-04 · PASS · Session Domain — W/L y personaje por partida**

- `computeSessionStats` suma todas las partidas sin importar el personaje.
- `match.player_character` se persiste en cada partida, así que el **W/L por personaje ya se puede
  derivar** de los datos existentes, sin migración.
- La deduplicación, el orden y el baseline por ID funcionan
  (`engine.test.ts`, `tracking.test.ts`, `authorization.test.ts`).

**F-05 · HIGH · Session Domain / Provider — la pertenencia a la sesión depende de los timestamps de CFN**

- **Finding:** `isMatchInSession` exige `playedAt >= startedAt − grace` y `> baselinePlayedAt`.
  - `startedAt` usa el reloj del servidor (`new Date()` en `startSession`).
  - La gracia por defecto es 0 s (`SESSION_START_GRACE_SECONDS`).
- **Impact:** con datos reales, la precisión de los timestamps de CFN (¿al minuto?), su zona horaria
  y su significado (¿inicio o fin del combate? ¿subida del replay?) son desconocidos.
  - Si redondean hacia abajo o están desfasados, **la primera partida tras "Iniciar sesión" puede
    descartarse en silencio**.
  - Si la zona horaria se interpreta mal, partidas anteriores podrían contarse.
- **Evidence:** `src/domain/session/engine.ts:181-200`, `src/server/sessions/service.ts:124`.
- **Recommendation:**
  - Hacer de la **pertenencia por ID** el criterio principal: cuenta toda partida que no estaba en
    el snapshot del baseline, con `playedAt` solo como red de seguridad y una gracia de 60–120 s.
  - Validar antes la zona horaria y la precisión con `provider:check` (§2.4).

**F-06 · LOW · Session Domain — fases de MR**

- **Finding:** la captura de CFN muestra "Fase 13 · MR". Si el MR se reinicia por fase, una sesión
  que cruce el cambio de fase mostraría un delta absurdo.
- **Recommendation:** guardar `phase` en el snapshot por personaje y no restar entre fases
  distintas. Es un caso raro.

**F-07 · LOW · Provider — ambigüedad de `mainCharacter`**

- **Finding:** el perfil dice "main / most recently used character", que son dos cosas distintas.
- **Recommendation:** separar `favoriteCharacter` (el que CFN muestra en el perfil) del
  `lastPlayedCharacter` (que se deriva de la última partida).

### 1.2 Caso crítico reproducido (motor actual, script de solo lectura)

Secuencia:

- A.K.I.: 1476 MR → victoria → 1501 → derrota → 1484.
- Cambio a Kimberly: 16.320 LP → victoria → 16.440.

```
# perfil sigue devolviendo A.K.I.
W/L 2-1  system=mr  primary={initial:1476,current:1484,delta:+8}      ← el +120 LP de Kimberly no aparece
# perfil devuelve el último personaje jugado (Kimberly)
W/L 2-1  system=lp  primary={initial:25000,current:16440,delta:-8560}  ← delta FALSO
rank Master -> Diamond 3                                               ← "degradación" FALSA
```

| #   | Pregunta                                     | Hoy                                                              | Debería                                                                                                  |
| --- | -------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | ¿El W/L suma las 3 partidas?                 | Sí (2-1) ✓                                                       | Sí: total 2V-1D, con desglose A.K.I. 1-1 y Kimberly 1-0                                                  |
| 2   | ¿El delta de MR sigue siendo solo de A.K.I.? | Depende de lo que devuelva el perfil, y puede mezclar personajes | Siempre por personaje: A.K.I. +8 MR, Kimberly +120 LP                                                    |
| 3   | ¿MR y LP a la vez?                           | No: un único "primary"                                           | Una línea por personaje, cada una con su unidad. Nunca se suman ni se restan entre sí                    |
| 4   | ¿Baseline por personaje?                     | No existe                                                        | Una tabla `session_character_baseline` (§1.3)                                                            |
| 5   | ¿Overlay con varios personajes?              | Un único rating, posiblemente falso                              | V/D global más el rating del **personaje activo** (el de la última partida). Opcional: "+8 MR · +120 LP" |
| 6   | ¿Session History?                            | Un único delta                                                   | V/D global más chips por personaje (A.K.I. +8 MR · Kimberly +120 LP)                                     |
| 7   | ¿Filtrar por personaje?                      | No                                                               | Sí: filtro opcional en historial y resumen. El overlay puede fijarse a un personaje                      |
| 8   | ¿Se pierde información o hay delta falso?    | **Ambas cosas** (F-01, F-02)                                     | —                                                                                                        |

### 1.3 Dirección de dominio propuesta (sin implementar)

Tu propuesta es correcta: una sesión pertenece al jugador, admite varios personajes y lleva el
progreso por personaje. Mantenerla, con estas precisiones:

1. **Clave de personaje estable** (`characterKey`, por ejemplo `"aki"`, `"kimberly"`), no el
   nombre visible: los nombres dependen del idioma de la cuenta del extractor.
2. **Snapshot de baseline por personaje.** Al iniciar la sesión se guardan todos los personajes
   del perfil: `(session_id, character_key, rank, lp, mr, phase, captured_at)`.
   - Si un personaje no estaba en el snapshot (primera partida con él), su baseline se toma del
     `ratingBefore` de su primera partida, o se marca como "desconocido" (sin delta) en lugar de
     inventarlo.
3. **Rating actual por personaje.**
   - Se toma del `ratingAfter` de la última partida de ese personaje, o del perfil por personaje,
     el que sea más reciente.
4. **Funciones puras nuevas** en el Session Engine:
   - `computeCharacterProgress(baselines, matches, currentByChar)`, que devuelve
     `CharacterProgress[] = { characterKey, wins, losses, system, initial, current, delta }`.
   - Invariante: **nunca se resta entre personajes distintos ni entre MR y LP**; sin datos, el
     delta es `null`.
   - El V/D global se queda en `computeSessionStats` (ya es correcto).
5. **Presentación:**
   - Overlay: V/D global más el personaje activo (rating y delta), opcionalmente fijado a un
     personaje.
   - Panel y resumen: una tabla por personaje.
6. **Al finalizar la sesión:** guardar el rating final por personaje
   (`session_character_baseline.final_*`).

Alternativa considerada: **una sesión por personaje.** La descarto como modelo principal porque no
encaja con cómo juega y transmite un streamer (cambiar de personaje dentro del mismo directo), y
duplicaría overlays y URLs. Sí conviene ofrecerla como vista mediante el filtro por personaje.

Esto exige cambios en el schema (una tabla nueva), en el contrato del provider y en el engine.
Queda pendiente de tu aprobación.

### 1.4 MR / LP — estado actual

| Aspecto                            | Estado                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `currentMR` / `currentLP`          | En `sf6_player`, a nivel de **jugador** ✗                                                                           |
| `initialMR` / `initialLP`          | En `game_session.initial_*`, a nivel de **sesión** ✗                                                                |
| Cálculo del delta                  | `buildRatingView`: `current − initial` del mismo campo, sin saber el personaje ✗                                    |
| Cambio de personaje                | Delta falso o progreso oculto (§1.2) ✗                                                                              |
| Un personaje Master y otro Diamond | `resolveRatingSystem` decide MR o LP por el snapshot **actual**, así que salta de sistema al cambiar de personaje ✗ |
| Detección de Master                | `resolveRatingSystem` usa la regex `/master/i` sobre la etiqueta de rango, que depende del idioma (§2.5) ⚠          |

### 1.5 Campos de `NormalizedSF6Match`

| Campo                                                      | Clase                              | Motivo                                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `externalMatchId`                                          | **REQUIRED**                       | Clave de deduplicación (`match_player_external_uq`). Debe ser estable y única por combate, igual en cada página                 |
| `playedAt`                                                 | **REQUIRED**                       | Orden, rachas y ventana de sesión. Un instante absoluto (UTC), con el significado documentado                                   |
| `mode`                                                     | **REQUIRED**                       | El filtro por defecto es solo Ranked: si se mapea mal, se cuentan 0 partidas                                                    |
| `result`                                                   | **REQUIRED**                       | Victoria, derrota o empate, desde la perspectiva del jugador seguido                                                            |
| `playerCharacter` → `characterKey` + nombre                | **REQUIRED** (hoy es _nullable_ ✗) | Atribución por personaje: sin él no hay progreso por personaje                                                                  |
| `opponentCharacter`                                        | OPTIONAL                           | Estadísticas de matchup futuras                                                                                                 |
| `opponentName`                                             | OPTIONAL                           | Solo se muestra en el resumen (minimización de datos)                                                                           |
| `playerRank` (al jugar)                                    | OPTIONAL (recomendado)             | Detecta ascensos y fija el sistema MR/LP por partida                                                                            |
| `opponentRank`                                             | NOT NEEDED (MVP)                   | Solo informativo                                                                                                                |
| `playerMRAfter` / `playerLPAfter`                          | OPTIONAL, **muy recomendado**      | El rating actual por personaje sin llamar al perfil. Reduce la carga (§4.6)                                                     |
| `playerMRBefore` / `playerLPBefore`                        | OPTIONAL                           | Baseline de un personaje que no estaba en el snapshot inicial. **Pasa a ser REQUIRED si el perfil no da ratings por personaje** |
| Delta por partida                                          | DERIVABLE                          | Es `after − before`                                                                                                             |
| `playerControlType`                                        | OPTIONAL                           | Clásico o Moderno; informativo                                                                                                  |
| Bando P1/P2, rondas                                        | NOT NEEDED                         | El provider ya resuelve la perspectiva                                                                                          |
| Estado de la partida (completada, desconectada, cancelada) | OPTIONAL                           | Si CFN muestra partidas canceladas, el provider debe **excluirlas** o marcarlas (§2.6, punto 14)                                |

---

## 2. Integración real con CFN / Capcom

### 2.1 Qué espera `SF6DataProvider` hoy

Archivo: `src/server/sf6/provider.ts`.

- `getPlayerProfile(cfnUserId, {signal})` devuelve un perfil. Si el jugador no existe, lanza
  `SF6ProviderError("not_found")`.
- `getRecentMatches(cfnUserId, {signal})` devuelve la última página. Se aceptan duplicados y
  cualquier orden.
- **Errores:** `not_found` (permanente), `rate_limited` (con `retryAfterMs`), `unavailable`,
  `timeout`, `invalid_response`.
- **`ResilientProvider` añade:**
  - Timeout de 10 s y single-flight.
  - Caché de perfil de 5 s.
  - Validación Zod: las partidas inválidas se **descartan y se registran en el log**; un perfil
    inválido es un error.

### 2.2 Qué valida `pnpm provider:check` hoy

Archivo: `scripts/provider-check.ts`.

- Valida el perfil (y falla si no cumple el schema), las partidas válidas y su número.
- Avisa de IDs duplicados dentro de la misma respuesta y de timestamps en el futuro.
- **No comprueba:**
  - Cuántas partidas se descartaron por inválidas (solo queda en el log).
  - El orden cronológico ni el tamaño de página.
  - La coherencia de la zona horaria con la hora real de la partida.
  - El reparto de modos ni el mapeo de personajes.
  - Los ratings por personaje (el contrato aún no los tiene).
- **Recomendación:** ampliar el check una vez cambie el contrato (§6, P0-3).

### 2.3 Qué debe mapear el extractor (contrato propuesto)

**Perfil**

- `cfnUserId`, que debe coincidir con el pedido.
- `displayName`.
- `favoriteCharacterKey`, opcional.
- `characters[]`, con una entrada por cada personaje que tenga datos de liga:
  - `characterKey` (estable) y `characterName` (visible).
  - `rank`: etiqueta tal como la devuelve CFN, más `rankTier` normalizado si es posible
    (por ejemplo `"diamond-3"`, `"master"`).
  - `ratingSystem` (`"lp"` o `"mr"`). **Lo da el extractor**; no se infiere por regex.
  - `leaguePoints` y `masterRate` (`null` si no aplica).
  - `phase`, si existe.

**Partida**

- `externalMatchId`.
- `playedAt` en UTC, documentando qué instante representa.
- `mode`, a partir de la categoría de combate de CFN.
- `result`.
- `characterKey` y `characterName`.
- `opponent { name, characterKey, characterName }`.
- `rankAtMatch` (opcional).
- `ratingBefore` / `ratingAfter` (opcional, ver §1.5).
- `status`, si CFN muestra partidas no completadas.

**Comportamiento**

- Paginación o `getMatchesSince(lastKnownId)` si es posible (§4.1).
- `retryAfterMs` en respuestas 429.
- Detectar cuándo la sesión o las cookies del extractor caducan y lanzar `unavailable` con un
  código distinguible (afecta a **todos** los jugadores a la vez).

### 2.4 Checklist de validación: `pnpm provider:check 1733837998` frente a CFN

| #   | Comprobación                 | Cómo                                                                                                                |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Nombre                       | Igual al del perfil de CFN, incluidos caracteres especiales                                                         |
| 2   | CFN ID                       | `cfnUserId` coincide (1733837998)                                                                                   |
| 3   | Personajes                   | Misma lista que "Maestría (por personaje)" en CFN                                                                   |
| 4   | Rango por personaje          | Por ejemplo, A.K.I. Diamond; E. Honda, Kimberly, Mai, Sagat, M. Bison y Chun-Li Master                              |
| 5   | MR por personaje             | Los valores de la captura de CFN (por ejemplo E. Honda 1500, Kimberly 1479…)                                        |
| 6   | LP por personaje             | A.K.I. 19.704 LP                                                                                                    |
| 7   | Historial reciente           | Mismas partidas que "Historial" en CFN; anotar el tamaño de página                                                  |
| 8   | Timestamps                   | Comparar con la hora real local de 2 partidas; confirmar UTC, precisión (¿segundos o minutos?) y si es inicio o fin |
| 9   | Ranked frente a Casual       | Una partida de cada tipo con modos correctos; 0 en `unknown`                                                        |
| 10  | Personaje propio             | Correcto en cada partida, incluso tras un cambio de personaje                                                       |
| 11  | Personaje rival              | Correcto                                                                                                            |
| 12  | Victoria o derrota           | Desde tu perspectiva, sea P1 o P2                                                                                   |
| 13  | ID de partida                | Estable entre dos ejecuciones y único                                                                               |
| 14  | Orden cronológico            | Coherente con `playedAt`                                                                                            |
| 15  | Partidas descartadas         | 0 en el log `provider.match_invalid`                                                                                |
| 16  | Rating después de la partida | Si existe: el valor coincide con el progreso real tras la partida y no es el anterior                               |
| 17  | Latencia                     | Tiempo por llamada y desde el fin de la partida hasta que aparece en CFN                                            |
| 18  | Errores                      | Un ID inexistente da `not_found`; con la red cortada da `unavailable` o `timeout`                                   |

### 2.5 Supuestos actuales que pueden no cumplirse

| Supuesto                                                   | Riesgo                                                                                            | Dónde                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Hay un único rating por jugador                            | **No se cumple** (F-01)                                                                           | `types.ts`                          |
| La etiqueta de rango contiene "master"                     | Depende del idioma del extractor                                                                  | `rating.ts` (`resolveRatingSystem`) |
| `playedAt` es preciso y absoluto                           | Desconocido (F-05)                                                                                | `engine.ts`                         |
| La última página cubre los huecos                          | Desconocido: tamaño de página real (§4.1)                                                         | `tracker.ts`                        |
| Los nombres de personaje son estables                      | Están localizados                                                                                 | `match.player_character`            |
| El ID de partida es el mismo visto desde los dos jugadores | Irrelevante hoy (la deduplicación es por jugador), relevante para futuras uniones entre jugadores | —                                   |
| El perfil refleja el rating justo tras la partida          | CFN puede tardar en actualizarse; existe una ventana de seguimiento de 90 s                       | `tracker.ts`                        |

### 2.6 Casos reales a probar

Antes de cada prueba: `LOG_LEVEL=debug`, panel abierto y overlay en una segunda pestaña.

| #   | Caso                         | Procedimiento                                        | Esperado                                                                                            |
| --- | ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Victoria Ranked              | Iniciar sesión, jugar 1 partida                      | +1 V, delta del personaje correcto, overlay en ≤ intervalo de polling                               |
| 2   | Derrota Ranked               | Igual                                                | +1 D, racha de derrotas                                                                             |
| 3   | Rematch                      | Aceptar el rematch                                   | 2 IDs distintos, 2 partidas                                                                         |
| 4   | Varias contra el mismo rival | 3 seguidas                                           | 3 filas, 0 duplicados                                                                               |
| 5   | Cambio de personaje          | 1 partida A.K.I. y 1 Kimberly                        | V/D global 2; deltas separados (tras el fix P0-1)                                                   |
| 6   | Casual                       | 1 partida casual                                     | No cuenta con el filtro Ranked; `mode=casual` en la BD                                              |
| 7   | Battle Hub                   | 1 partida si aparece en el historial                 | `mode=battle_hub`, no cuenta                                                                        |
| 8   | Duplicada                    | Ejecutar `provider:check` dos veces y forzar 2 polls | `match.duplicated` y sin cambio de V/D                                                              |
| 9   | Fuera de orden               | Comprobar si CFN publica tarde alguna partida        | Rachas recalculadas en orden por `playedAt`                                                         |
| 10  | CFN no disponible            | Cortar la red del worker o del extractor 2 min       | `provider.error`, backoff, panel en "degradado", marcador intacto                                   |
| 11  | Worker detenido              | Parar el worker, jugar 2 partidas, arrancarlo        | Ambas partidas se detectan (≤ tamaño de página)                                                     |
| 12  | Varios personajes Master     | Jugar con 2 personajes Master                        | Dos deltas de MR independientes                                                                     |
| 13  | Diamond + Master             | A.K.I. (LP) y Kimberly (MR)                          | Unidades correctas por personaje, sin restar entre ellos                                            |
| 14  | Desconexión o cancelada      | Si aparece en el historial                           | Excluida o marcada; nunca se cuenta como victoria o derrota sin confirmar                           |
| 15  | Empate                       | Time-over con la misma vida, si ocurre               | `result=draw`; no afecta al porcentaje de victorias y corta la racha (comportamiento actual)        |
| 16  | Datos tardíos                | Comparar `playedAt` con la hora de detección         | La partida cuenta aunque llegue tarde, mientras sea posterior al inicio de sesión (depende de F-05) |

---

## 3. Seguridad de autenticación y cuentas

Configuración auditada: `src/server/auth/auth.ts` contra el código instalado de better-auth 1.7.7.

| ID   | Sev.                       | Área         | Hallazgo                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Impacto                                                                                                                                                                                               | Evidencia                                                                                                                                                                                        | Recomendación                                                                                                                                                                                     |
| ---- | -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | **HIGH**                   | Auth         | No hay verificación de email (`requireEmailVerification` no está activado y no hay emisor de emails)                                                                                                                                                                                                                                                                                                                                                                                 | Cualquiera puede registrarse con el email de otra persona y "ocuparlo"; no hay prueba de propiedad                                                                                                    | `auth.ts` (`emailAndPassword`)                                                                                                                                                                   | Proveedor de email transaccional y `requireEmailVerification: true`                                                                                                                               |
| S-02 | **HIGH**                   | Auth         | No hay reset de contraseña (`sendResetPassword` no está configurado)                                                                                                                                                                                                                                                                                                                                                                                                                 | Una cuenta con la contraseña olvidada queda perdida                                                                                                                                                   | `auth.ts`                                                                                                                                                                                        | Configurarlo. El token de better-auth es de un solo uso y caduca a 1 h por defecto (`resetPasswordTokenExpiresIn`). Activar **`revokeSessionsOnPasswordReset: true`**, que por defecto es `false` |
| S-03 | MEDIUM                     | Auth         | Enumeración de emails en el registro                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Un atacante puede saber qué emails tienen cuenta                                                                                                                                                      | `better-auth/dist/api/routes/sign-up.mjs:155,204` (solo devuelve una respuesta genérica si se requiere verificación o `autoSignIn:false`). Además, `AuthForm.tsx` muestra "ya existe una cuenta" | Con S-01 se obtiene la respuesta genérica; usar `onExistingUserSignUp` para avisar al dueño real. El **login ya es genérico ✓**                                                                   |
| S-04 | **HIGH**                   | Auth / Infra | Resolución de la IP del cliente. better-auth lee `x-forwarded-for` y, sin `trustedProxies`, **descarta cadenas con más de una IP**; entonces usa un **bucket compartido `no-trusted-ip`**                                                                                                                                                                                                                                                                                            | Tras un proxy real, el login de **todo el sitio** queda limitado a 3 por 10 s. Un atacante puede bloquear el login de todos. Si la app estuviera expuesta sin proxy, la cabecera se podría falsificar | `@better-auth/core/dist/utils/ip.mjs:174-194`, `api/rate-limiter/index.mjs:236-248`                                                                                                              | Configurar `advanced.ipAddress.trustedProxies` o `ipAddressHeaders` según la plataforma (por ejemplo `Fly-Client-IP`, `CF-Connecting-IP`); `TRUST_PROXY` para nuestro propio limitador            |
| S-05 | **HIGH** (multi-instancia) | Auth / Infra | Rate limiting en memoria: better-auth usa `storage:"memory"` por defecto y `src/server/security/rate-limit.ts` usa un `Map`                                                                                                                                                                                                                                                                                                                                                          | Con N instancias el límite real es N veces mayor, y cada reinicio o deploy lo pone a cero                                                                                                             | `auth.ts`, `rate-limit.ts`                                                                                                                                                                       | §3.3                                                                                                                                                                                              |
| S-06 | MEDIUM                     | Auth         | Política de contraseñas con mínimo de 8 caracteres                                                                                                                                                                                                                                                                                                                                                                                                                                   | Débil cuando la contraseña es el único factor                                                                                                                                                         | `auth.ts` (`minPasswordLength: 8`)                                                                                                                                                               | §3.2                                                                                                                                                                                              |
| S-07 | MEDIUM                     | Auth / UX    | No hay UI para cambiar la contraseña ni para ver o revocar sesiones. Los endpoints de better-auth existen (`/change-password` admite `revokeOtherSessions`)                                                                                                                                                                                                                                                                                                                          | El usuario no puede cerrar una sesión robada                                                                                                                                                          | —                                                                                                                                                                                                | Pantalla de cuenta: cambiar contraseña (con `revokeOtherSessions: true`), lista de sesiones y "cerrar todas"                                                                                      |
| S-08 | MEDIUM                     | Secrets      | El secreto de ejemplo de `.env.example` (44 caracteres) **pasa la validación**                                                                                                                                                                                                                                                                                                                                                                                                       | Producción podría arrancar con un secreto público, lo que permite falsificar cookies                                                                                                                  | `env.ts:18`, `.env.example:10`                                                                                                                                                                   | En producción, rechazar el valor de ejemplo y secretos de baja entropía                                                                                                                           |
| S-09 | MEDIUM                     | Producto     | Cambiar de CFN en `/onboarding` **borra el historial** con un solo clic y sin reautenticación                                                                                                                                                                                                                                                                                                                                                                                        | Pérdida de datos accidental o por una sesión robada                                                                                                                                                   | `players/service.ts` (`upsertPlayerForUser`)                                                                                                                                                     | Confirmación explícita y comprobar `freshAge` (better-auth: 1 día por defecto)                                                                                                                    |
| S-10 | LOW                        | Auth         | Sin 2FA                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Riesgo ante credential stuffing                                                                                                                                                                       | —                                                                                                                                                                                                | Plugin `two-factor` (TOTP y códigos de recuperación, ya incluido en el paquete): P2                                                                                                               |
| S-11 | LOW                        | Headers      | Sin CSP ni HSTS                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Defensa en profundidad frente a XSS                                                                                                                                                                   | `next.config.ts`                                                                                                                                                                                 | HSTS desde la plataforma o la app; CSP con nonce: P2                                                                                                                                              |
| S-12 | INFO                       | Privacidad   | Sin borrado ni exportación de cuenta                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Requisito RGPD si hay usuarios de la UE                                                                                                                                                               | —                                                                                                                                                                                                | P2                                                                                                                                                                                                |
| S-13 | MEDIUM                     | Producto     | **Propiedad del CFN**: cualquier cuenta puede registrar cualquier CFN, sin unicidad                                                                                                                                                                                                                                                                                                                                                                                                  | Overlays de "suplantación" (solo datos públicos) y polling duplicado del mismo CFN                                                                                                                    | `onboarding/actions.ts`, sin índice único en `cfn_user_id`                                                                                                                                       | §3.5                                                                                                                                                                                              |
| —    | PASS                       | Auth         | Contraseñas con **scrypt** (por defecto en better-auth, sin truncado), cookies `HttpOnly`, `SameSite=Lax` y `Secure` con https (`useSecureCookies`), sesión en BD revocable, logout borra la sesión, comprobación de Origin con `trustedOrigins` y en Server Actions, límites especiales de better-auth en sign-in, sign-up y change-password (3/10 s) y en reset (comprobado en `rate-limiter/index.mjs:305-317`), login genérico, `autocomplete` correcto y sin bloquear el pegado | —                                                                                                                                                                                                     | `auth.ts`, `AuthForm.tsx`                                                                                                                                                                        | —                                                                                                                                                                                                 |

### 3.1 Autorización / IDOR — **PASS**

| Superficie                                                                          | Cómo autoriza                                                                                                                    | Resultado                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Server actions (`dashboard/actions.ts`, `onboarding/actions.ts`, `i18n/actions.ts`) | `getCurrentUser()` en cada acción; el jugador se resuelve desde la sesión y nunca desde un `playerId` del cliente                | PASS                     |
| `saveOverlay`, `rotate` y `delete`                                                  | `getOwnedOverlay(db, user.id, overlayId)` con JOIN a `sf6_player.user_id`                                                        | PASS (cubierto por test) |
| `/dashboard/sessions/[id]`                                                          | `getOwnedSession(player.id, id)`                                                                                                 | PASS (cubierto por test) |
| `/dashboard/overlays/[id]`                                                          | `getOwnedOverlay(user.id, id)`                                                                                                   | PASS                     |
| `/api/me/stream`                                                                    | Sesión de better-auth en el servidor; el jugador sale de la sesión                                                               | PASS                     |
| `/api/overlay/[token]/*`                                                            | Solo lectura; no existe ninguna mutación que acepte un token                                                                     | PASS                     |
| Herramientas de desarrollo                                                          | `devToolsEnabled()` exige NODE_ENV distinto de production, el flag activo y el provider mock; además usa el jugador de la sesión | PASS                     |
| `cfnUserId`                                                                         | Solo se usa en onboarding, ligado al usuario de la sesión                                                                        | PASS (ver S-13)          |

Test añadido: `tests/integration/authorization.test.ts` comprueba que el usuario A no puede obtener
el overlay ni la sesión del usuario B.

### 3.2 Política de contraseñas recomendada

- Mínimo **12** caracteres, o **15** si la contraseña es el único factor (dirección NIST
  SP 800-63B-4). Máximo 128, como ahora; scrypt no trunca.
- Sin reglas de composición. Se admiten frases de contraseña y pegado (los gestores de contraseñas
  ya funcionan).
- Bloquear contraseñas comprometidas con el plugin **`haveibeenpwned`** de better-auth (incluido;
  usa k-anonimato y solo envía un prefijo del hash).
- La política actual es lo que el stack permite por defecto (`minPasswordLength` 8,
  `maxPasswordLength` 128); el resto es configuración.

### 3.3 Rate limiting entre instancias

- **No basta con memoria** si hay más de una instancia o se despliega a menudo.
- La opción más simple y robusta es **Postgres**, que ya existe:
  - better-auth: `rateLimit.storage: "database"` (tabla `rateLimit`, generada por el CLI y añadida
    al schema de Drizzle).
  - Nuestro limitador: una tabla `rate_limit_bucket(key, window_start, count)` con un `UPSERT`
    atómico.
  - El coste es una escritura por intento, aceptable para endpoints de autenticación y overlay.
- **Redis o Upstash:** sobra mientras Postgres aguante; reconsiderar con mucho más tráfico.
- **CDN o WAF** (Cloudflare): complemento útil contra abuso volumétrico, no sustituto.
- **Requisito previo en cualquier caso:** resolver bien la IP del cliente (S-04).

### 3.4 Overlay público — **PASS** con notas

- Token de 192 bits en `base64url` (`tokens.ts`), con formato validado antes de consultar la BD.
  No es enumerable.
- **Revocación:** "Regenerar URL" invalida el token al instante y cierra los SSE abiertos con el
  evento `revoked`.
- **Caché:** `no-store`, `noindex` y `Referrer-Policy: no-referrer` (`next.config.ts`,
  `public.ts`).
- **Datos expuestos:** solo nombre visible, personaje, estadísticas, rating y config. Sin CFN ID ni
  IDs internos (test). Es **de solo lectura**.
- **LOW:** la página `/overlay/[token]` no tiene rate limit (la API sí), y cada conexión SSE escribe
  una fila de presencia. Está acotado por el límite de 60 conexiones/min por IP, pero conviene
  pasarlo a almacenamiento compartido (§3.3).

### 3.5 Propiedad del CFN — opciones

| Opción                                                                                                                                                                                    | Ventajas                                            | Costes                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| A. Permitir cualquier CFN (hoy)                                                                                                                                                           | Cero fricción                                       | Suplantación visual y polling duplicado                                    |
| B. Reclamación: el primero lo reclama, con disputa manual                                                                                                                                 | Simple                                              | El primero no es necesariamente el dueño; requiere soporte                 |
| C. Verificación manual                                                                                                                                                                    | Fiable                                              | No escala                                                                  |
| D. **Prueba vía perfil CFN**: poner un código temporal en un campo editable del perfil (título, comentario o apodo, a confirmar qué campo lee el extractor) y verificarlo con el provider | Automática, prueba control real                     | Depende de que el extractor lea ese campo; añade fricción en el onboarding |
| E. Híbrido: permitir sin verificar, marcar "verificado" con D, y deduplicar el polling por CFN entre usuarios                                                                             | Sin fricción en el MVP; resuelve la carga duplicada | Algo más de complejidad                                                    |

Recomendación: **E** para producción. Para el MVP con pocos streamers, A es aceptable.

---

## 4. Robustez de producción

### 4.1 Worker caído 5 minutos — PASS con una advertencia (R-01 · MEDIUM)

- **Funciona:**
  - El lease caduca en 60 s y cualquier worker lo retoma.
  - Al volver, el siguiente poll trae la última página y la ingesta asigna a la sesión todo lo
    posterior al inicio (por timestamp). En 5 minutos son unas 2 partidas, sin pérdida.
- **Límite (R-01):** solo se lee **la última página** (el mock usa 20; el tamaño real se
  desconoce). Una caída de horas o una página pequeña **pierde partidas** sin avisar. "Finalizar
  sesión" tiene el mismo límite.
- **Evidencia:** `tracker.ts` (`pollPlayer`), `mock.ts:140`.
- **Recomendación:** paginar hasta encontrar un ID conocido, o un método `getMatchesSince`, y
  emitir `tracker.gap_suspected` cuando la página no contenga ningún ID conocido.

### 4.2 Web caída con el worker activo — PASS

- El worker sigue ingiriendo.
- Al volver, el overlay ya tenía el último estado, se reconecta y recibe el estado completo.
- Verificado de punta a punta: reconexión en 3,2 s, incluyendo una partida jugada durante la
  caída.

### 4.3 Postgres no disponible — PASS

- Los errores del tick se capturan con backoff hasta 30 s (`worker/index.ts`).
- La ingesta va en una transacción con `ON CONFLICT DO NOTHING`. Un poll interrumpido hace
  rollback y el siguiente vuelve a traer la página.
- **No hay doble conteo:** cubierto por los tests de reingesta ×10 y de 5 ingestas concurrentes.
- El `LISTEN` de postgres.js se reconecta y el hub fuerza la resincronización
  (`hub.relistened_resync`).

### 4.4 Fallos del provider

| Fallo              | Comportamiento actual                                                                                                          | Veredicto                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| timeout            | `SF6ProviderError("timeout")` a los 10 s, backoff exponencial con jitter (30→60→120→300 s) y estado "degradado"                | PASS                                                          |
| 429                | Si el extractor pasa `retryAfterMs`, se respeta; si no, backoff normal. **Solo por jugador**, no global                        | ⚠ R-02                                                        |
| 500                | Error genérico pasa a `unavailable` y backoff                                                                                  | PASS                                                          |
| Respuesta inválida | Perfil: `invalid_response` y backoff. Partidas: se descartan una a una y el resto se ingiere                                   | PASS (ver §2.2: el check no muestra el número de descartadas) |
| Datos parciales    | Las partidas sin campos requeridos se descartan. **Riesgo:** si falta `playerCharacter` (hoy _nullable_), se acepta igualmente | ⚠ F-01/§1.5                                                   |

**R-02 · HIGH · Worker / Provider — no hay presupuesto global de llamadas.** Todos los jugadores
comparten el mismo extractor (una cuenta o IP ante Capcom).

- **Impact:** con un 429 o una ventana de mantenimiento, cada jugador hace backoff por separado
  mientras los demás siguen consultando, lo que agrava el bloqueo y arriesga un baneo de la cuenta
  del extractor.
- **Recommendation:**
  - Un token bucket global en Postgres (o un límite de llamadas por segundo por worker y por
    número de workers).
  - Un circuit breaker global: tras un 429 o un fallo de sesión del extractor, pausar todos los
    polls durante `Retry-After`.

### 4.5 Varios workers / race del lease — PASS

- Escenario: A toma el lease, A se ralentiza, el lease caduca, B lo toma y A termina tarde.
  - Ambos ingieren las mismas partidas: el índice único y `ON CONFLICT` garantizan una sola fila.
  - La asignación a la sesión se hace con `SELECT … FOR UPDATE` sobre la fila de la sesión
    (`ingest.ts`).
  - La liberación y la reprogramación usan `WHERE lease_owner = workerId`, así que A no pisa el
    lease de B.
  - Tests: lease exclusivo (`tracking.test.ts`) y 5 ingestas concurrentes (`authorization.test.ts`).
- **R-03 · LOW:** `updatePlayerProfile` **no** comprueba el lease, así que A podría sobrescribir
  durante un poll el perfil más reciente de B. Se corrige solo en el siguiente poll.
  **Recommendation:** escribir el perfil solo si `profile_updated_at` es anterior a la marca de
  tiempo del fetch.

### 4.6 SSE — PASS

- Cada conexión envía primero el **estado completo**, y cada evento posterior también es completo.
  No se necesita `Last-Event-ID`.
- Un evento perdido se corrige en la siguiente reconexión.
- Cliente: reconexión del navegador más reconexión manual con backoff, watchdog de 45 s con pings
  cada 15 s, y respaldo por polling a `/state`.
- Varias pestañas y reconexiones de OBS no generan trackers: el hub construye un snapshot por
  jugador.
- En un deploy, el SIGTERM del worker es ordenado y el SSE se reconecta.

### 4.7 Carga estimada (polling ~20 s)

Supuestos:

- 3 llamadas/min a la lista de partidas por jugador.
- Perfil: tras cada partida, más el seguimiento de 90 s (unas 4-5 llamadas por partida), más el
  refresco cada 5 min. Con una partida cada ~3 min salen unas 1-1,5 llamadas/min.
- **Total: ~4-4,5 llamadas/min por jugador activo.**

| Jugadores activos | Llamadas/min al provider | Llamadas/s | Polls/min (worker) |
| ----------------- | ------------------------ | ---------- | ------------------ |
| 10                | ~45                      | ~0,75      | 30                 |
| 100               | ~450                     | ~7,5       | 300                |
| 1000              | ~4.500                   | ~75        | 3.000              |

Implicaciones:

- Con concurrencia 10 y ~1 s de latencia, un worker hace unos 600 polls/min, así que **1000
  jugadores necesitan al menos 5 workers** o más concurrencia.
- Si el extractor usa un navegador headless, la capacidad es mucho menor.
- Por encima de ~100 jugadores, el volumen contra una sola cuenta de CFN es arriesgado.

Recomendaciones:

- `ratingAfter` por partida eliminaría la mayoría de llamadas al perfil (la carga baja a unas
  ~3/min por jugador).
- Polling adaptativo: si no hay partidas en 10 min, pasar a 45-60 s.
- Deduplicar por CFN (S-13 / opción E).
- Presupuesto global (R-02).

### 4.8 Observabilidad

| Señal                                     | Estado                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Partida detectada / duplicada             | ✓ `match.detected` (info), `match.duplicated` (**debug**)                                                           |
| Actualización de sesión                   | ✓ `session.update`, `session.started`, `session.ended`                                                              |
| Fallos del provider                       | ✓ `provider.error` con `code` y `failures`                                                                          |
| Eventos de rate limit                     | ⚠ Solo como `code=rate_limited` dentro de `provider.error`; no hay métrica                                          |
| Tiempo de respuesta del provider          | ✗ Solo `player.polled.ms` (total del poll, **en debug**). No hay latencia por llamada ni distinción perfil/partidas |
| Latencia del poll / retraso del scheduler | ✗ No se mide `now − next_poll_at` al reclamar                                                                       |
| Conflicto de lease                        | ✗ No se detecta cuando el `UPDATE … WHERE lease_owner` afecta a 0 filas                                             |
| Conexiones SSE                            | ✓ `sse.connect` / `sse.disconnect` con número de suscriptores; presencia en BD                                      |
| Latencia partida → overlay                | ✗ No se registra (`playedAt` → `ingestedAt` → publicación → envío SSE)                                              |
| Métricas agregadas                        | ✗ No hay endpoint de métricas ni OpenTelemetry                                                                      |
| Redacción de secretos                     | ✓ La redacción por clave está testeada (`logger.test.ts`); los logs de SSE usan `overlayId`, nunca el token         |

**Recommendation (P1):**

- Eventos `provider.call` (operación, ms, resultado), `scheduler.lag_ms`, `lease.lost` y
  `match.e2e_latency_ms`.
- Subir `match.duplicated` a info con muestreo.
- Opcional: OpenTelemetry o un endpoint `/metrics` para el worker.

### 4.9 Otros

- **R-04 · MEDIUM:** iniciar y finalizar sesión llama al provider **desde el proceso web**, así que
  la web necesita las credenciales del extractor. Si el extractor es pesado (headless), conviene
  delegarlo al worker mediante un job.
- **R-05 · LOW:** los E2E de Playwright usados en fases anteriores **no están en el repo** (eran
  scripts temporales). Conviene versionarlos.

---

## 5. Cobertura de tests

| Área                                                             | Estado                                                                               | Dónde                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Sesiones multi-personaje                                         | **NOT TESTED** (el W/L global sí)                                                    | —                                                             |
| MR/LP por personaje                                              | **NOT TESTED** (no existe el modelo)                                                 | —                                                             |
| Provider real                                                    | **NOT TESTED**                                                                       | `provider:check` es manual                                    |
| Seguridad de auth (verificación, reset, rate limit, enumeración) | **NOT TESTED**                                                                       | —                                                             |
| IDOR                                                             | **CURRENTLY TESTED** (servicios) · PARTIAL (no hay tests HTTP ni de server actions)  | `authorization.test.ts`                                       |
| Token del overlay                                                | PARTIALLY TESTED (formato, minimización del payload)                                 | `security.test.ts`, `authorization.test.ts`                   |
| Recuperación del worker                                          | PARTIALLY TESTED (relevo del lease; no hay test de caída mayor que una página)       | `tracking.test.ts`                                            |
| Fallo de BD                                                      | **NOT TESTED** (solo verificación manual)                                            | —                                                             |
| Fallo del provider                                               | CURRENTLY TESTED (timeout, inválido, `not_found`, caída, backoff)                    | `resilient.test.ts`, `tracking.test.ts`                       |
| Leases                                                           | CURRENTLY TESTED (exclusividad, expiración)                                          | `tracking.test.ts`                                            |
| Persistencia de sesión                                           | CURRENTLY TESTED (reconstrucción, fin, reinicio, restricción de sesión activa única) | `engine.test.ts`, `tracking.test.ts`                          |
| Reconexión SSE                                                   | PARTIALLY TESTED (E2E manual fuera del repo)                                         | —                                                             |
| Duplicados                                                       | CURRENTLY TESTED (unitario, ×10 e ingesta concurrente)                               | `engine.test.ts`, `tracking.test.ts`, `authorization.test.ts` |
| Partidas fuera de orden                                          | CURRENTLY TESTED                                                                     | `engine.test.ts`                                              |

---

## 6. Priorización

### P0 — antes de conectar usuarios o datos reales

1. **Modelo de rating por personaje** (F-01, F-02, F-03):
   - Contrato del provider con `characters[]` y `characterKey`.
   - Tabla de baseline por personaje.
   - `computeCharacterProgress` con la invariante "nunca restar entre personajes".
   - Overlay basado en el personaje activo.
2. **Pertenencia a la sesión por ID del baseline** y gracia de 60-120 s; validar zona horaria y
   precisión reales (F-05).
3. **Ampliar `provider:check`**: partidas descartadas, orden, tamaño de página, modos y ratings por
   personaje. Ejecutar el checklist §2.4 con el CFN 1733837998.
4. **Resolución de IP tras el proxy** en better-auth y en nuestro limitador (S-04).
5. **Rechazar el secreto de ejemplo** en producción (S-08). Es trivial.
6. Si el registro va a ser público: **verificación de email, reset de contraseña y
   `revokeSessionsOnPasswordReset`** (S-01, S-02, S-03).

### P1 — antes de producción

1. **Presupuesto global y circuit breaker** de llamadas a CFN (R-02).
2. **Rate limiting compartido en Postgres** (S-05, §3.3).
3. Paginación o `getMatchesSince` y alerta de hueco (R-01).
4. Política de contraseñas de 12-15 caracteres más `haveibeenpwned` (S-06).
5. Pantalla de cuenta: cambiar contraseña, ver y revocar sesiones (S-07).
6. Confirmación y reautenticación al cambiar de CFN (S-09).
7. Observabilidad: latencia del provider, retraso del scheduler, lease perdido y latencia
   partida → overlay (§4.8).
8. Decidir la propiedad del CFN y deduplicar el polling por CFN (S-13).
9. HSTS (S-11).
10. Versionar los E2E de Playwright en el repo (R-05).

### P2 — recomendable

- 2FA TOTP con códigos de recuperación (S-10).
- Borrado y exportación de cuenta (S-12).
- CSP con nonce.
- Filtro por personaje en historial y resumen.
- Escritura del perfil condicionada al lease (R-03).
- Polling adaptativo.
- Delegar el baseline de inicio de sesión al worker (R-04).

### P3 — futuro

- Gestión de fases y temporadas de MR (F-06).
- Rango del rival y matchups.
- WAF o CDN contra abuso volumétrico.
- OpenTelemetry completo.
