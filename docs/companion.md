# SF6 Session Companion (MVP)

Extensión de navegador (Manifest V3, Chrome/Edge ≥ 120). Lee **tus** datos de Buckler's Boot Camp
**en tu navegador normal**, con tu sesión normal, los normaliza y envía al Session Tracker solo
datos normalizados. Es **solo una fuente de datos**: sesiones, W/L, baselines, deltas, dedupe y
overlays siguen siendo responsabilidad del backend.

## 1. Por qué existe

La investigación (`docs/research/2026-10-03-cfn-network-research.md`, `docs/capcom-provider.md`)
mostró que el acceso desde el servidor no es viable:

| Vía                               | Resultado                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------- |
| HTTP directo desde el backend     | 403 de CloudFront                                                                |
| Playwright headless               | 403 de CloudFront                                                                |
| Playwright con sesión exportada   | 403 de CloudFront                                                                |
| Playwright con perfil persistente | El login de Capcom (verificación de seguridad) entra en bucle con automatización |
| **Navegador normal del usuario**  | **Funciona** (el HAR se capturó así)                                             |

Por eso la adquisición se hace en el navegador real del usuario, sin automatizar login ni evadir
nada.

## 2. Arquitectura

```
Navegador normal (login manual en Buckler)
   │
   ▼
SF6 Session Companion (apps/companion-extension, MV3)
   ├─ Buckler transport   service worker │ pestaña ISOLATED │ pestaña MAIN  (el test decide)
   ├─ parse/normalize     @sf6/capcom-core  ← MISMO código que el provider de servidor
   └─ Tracker client      Bearer device token, credentials: "omit"
   │
   ▼  POST /api/companion/sync  (solo datos normalizados)
Session Tracker
   ├─ validación Zod estricta + ownership + límites
   ├─ companion_snapshot  ──► CompanionSF6DataProvider (SF6_PROVIDER=companion)
   ├─ ingestMatches (dedupe + asignación de sesión bajo lock)  ← pipeline existente
   └─ Session Engine → DB → SSE → overlay (OBS sin cambios)
```

- **Código compartido:** `packages/sf6-capcom-core` (alias `@sf6/capcom-core`).
  - Contiene tipos del contrato, esquemas Zod, `parse`/`normalize`, `league`, paginación, buildId,
    URLs de Buckler y el contrato companion (esquemas de wire, polling, límites y detector de
    claves prohibidas).
  - Solo depende de `zod`: nada de Node, DB, env, Next, cookies ni APIs de extensión.
    `test/purity.test.ts` lo vigila.
- **Provider `companion`:** con `SF6_PROVIDER=companion`, `startSession`, `endSession`, el lookup
  del onboarding y el worker usan el último snapshot que envió el companion, mediante el mismo
  contrato `SF6DataProvider`. Si el snapshot tiene más de `COMPANION_SNAPSHOT_MAX_AGE_MS`
  (5 min), devuelve `unavailable`: nunca se arranca una sesión con un baseline viejo.
- **`/sync`:** ingiere directamente vía `ingestMatches`, que es idempotente. El worker puede
  volver a leer el snapshot sin efectos duplicados.

## 3. Modelo de seguridad

- **Las credenciales de Capcom nunca salen del navegador.**
  - La extensión no usa `chrome.cookies`, no lee `document.cookie` y no exporta nada.
  - El navegador adjunta su propia sesión a las peticiones a Buckler.
- **Al tracker solo viajan datos normalizados.** Se protege de cuatro formas:
  - serialización por _whitelist_ (`toWireMatch`/`toWireProfile`);
  - `findForbiddenKeys` antes de enviar (cookie, authorization, set-cookie, session token, csrf,
    buckler_id…), y el cliente se niega a enviar si encuentra alguna;
  - el nivel superior del payload es `strictObject` en el servidor: una clave inesperada
    (`cookies`) rechaza la petición con 422;
  - un test falla si cualquier body enviado contiene esas claves.
- **Device token:**
  - 256 bits aleatorios (`sf6c_…`) guardados en `chrome.storage.local`, nunca en el
    `localStorage` de una página;
  - en la DB solo se guarda su SHA-256;
  - es revocable y solo sirve para `/api/companion/*`: no es una sesión web.
- **Pairing code:** 8 caracteres Crockford, de un solo uso, TTL de 10 minutos, guardado como
  hash. Generar uno nuevo invalida los anteriores. `/pair` limita a 10 intentos por minuto y IP.
- **Ownership:**
  - un `/sync` con un CFN distinto del registrado por el usuario → 409 `cfn_mismatch`;
  - cada snapshot tiene un dueño por CFN; otra cuenta no puede sobrescribirlo
    (409 `cfn_owned_by_other`), salvo que el dueño no lo rastree y lleve más de 24 h sin
    actualizarse.
- **Validaciones de `/sync`:**
  - esquema completo y `characterKey` como slug;
  - `externalMatchId` obligatorio;
  - `playedAt` entre 2023-06-01 y ahora + 5 min;
  - máximo 100 partidas por petición y 256 KB de body (413).
- **Rate limit por dispositivo:** 1 sync cada 5 s y 20 `state` por minuto. Con la cadencia
  normal de 30 s nunca salta.
- **CORS** de `/api/companion/*`: `*` sin credenciales. Es seguro porque la autenticación es por
  Bearer y nunca por cookie.
- **Logs:**
  - eventos: `companion_paired`, `companion_sync`, `companion_sync_rejected`,
    `companion_device_revoked`, `companion_buckler_error`, `companion_buckler_test`;
  - sin payloads, sin nombres de rivales y sin tokens.
- **Sin evasión:** no hay Playwright, Selenium, stealth, hacks de webdriver, UA falso, proxies,
  captchas ni bypass.

## 4. Permisos de la extensión

| Permiso                                                       | Motivo                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `host_permissions: https://www.streetfighter.com/6/buckler/*` | `fetch` a Buckler con la sesión del navegador, inyectar en pestañas de Buckler y encontrarlas (`tabs.query` por URL sin el permiso `tabs`) |
| `storage`                                                     | `chrome.storage.local`: device token, estado y caché de IDs                                                                                |
| `alarms`                                                      | Despertar el service worker cada 30 s, sin trucos de keep-alive                                                                            |
| `scripting`                                                   | Transportes `isolated_tab` y `main_tab` (`chrome.scripting.executeScript`)                                                                 |

- **Sin permisos de** `cookies`, `tabs`, `webRequest` ni `<all_urls>`.
- **Tracker:** no hace falta permiso de host (se usa CORS).
- **CSP:** `script-src 'self'`; todo va empaquetado. Zod usa `jitless`, así que no hay `eval` ni
  `new Function` (verificado en el bundle).

## 5. Pairing

1. Dashboard → consola → **SF6 Session Companion** → **Conectar Companion**. Aparece
   `XXXX-XXXX`, válido 10 minutos y un solo uso.
2. Popup de la extensión: URL del tracker, código y nombre del dispositivo → **Conectar**.
3. `POST /api/companion/pair` → `{ deviceId, deviceToken, state }`. El token se guarda en
   `chrome.storage.local`.
4. Revocación:
   - desde el dashboard (botón **Revocar**);
   - desde la extensión (**Desconectar** → `POST /api/companion/disconnect`).

   Un token revocado recibe `401` y la extensión olvida el pairing.

En modo companion el panel aparece también en el onboarding: hay que vincular el companion
**antes** de registrar el CFN, porque el lookup sale del snapshot.

## 6. Datos enviados

`POST /api/companion/sync`:

```json
{
  "cfnUserId": "1733837998",
  "observedAt": "2026-10-03T03:00:00.000Z",
  "profile": {
    "cfnUserId": "…",
    "displayName": "…",
    "favoriteCharacterKey": "aki",
    "characters": [
      {
        "characterKey": "aki",
        "characterName": "A.K.I.",
        "rank": "Diamond 1",
        "rankTier": "diamond-1",
        "ratingSystem": "lp",
        "leaguePoints": 19704,
        "masterRate": null,
        "phase": null
      }
    ]
  },
  "matches": [
    {
      "externalMatchId": "VGPTB9UCN",
      "playedAt": "2026-10-03T02:53:21.000Z",
      "mode": "ranked",
      "result": "win",
      "characterKey": "aki",
      "characterName": "A.K.I.",
      "playerControlType": "classic",
      "opponent": {
        "name": "…",
        "characterKey": "chunli",
        "characterName": "Chun-Li",
        "rank": null
      },
      "ratingBefore": {
        "system": "lp",
        "value": 19633,
        "rank": "Diamond 1",
        "rankTier": "diamond-1",
        "phase": null
      },
      "ratingAfter": null
    }
  ],
  "gapSuspected": false,
  "client": { "version": "0.1.0", "transport": "service_worker" }
}
```

- Solo se envían partidas que el tracker aún no conoce, más el perfil cuando toca.
- **Rival:** solo nombre, personaje y rango si se conoce. No se envía el CFN del rival ni nada
  más.

## 7. Datos que NUNCA se envían

- Cookies, cabeceras `Cookie`/`Authorization`/`Set-Cookie`, tokens o IDs de sesión de Capcom.
- Clubes, comentarios, títulos, likes, redes sociales, emblemas, horarios de juego,
  estadísticas no usadas, historial ajeno.
- HTML o JSON en bruto de Buckler.

## 8. Polling

Configuración central: `COMPANION_POLLING` en `@sf6/capcom-core`. El servidor la devuelve en
cada `state`.

| Situación         | Buckler                                    | Tracker                |
| ----------------- | ------------------------------------------ | ---------------------- |
| Sesión activa     | battlelog p1 cada **30 s**, play cada 90 s | `state` en cada alarma |
| Sin sesión        | battlelog + play cada 120 s                | `state` cada 30 s      |
| 403 / 429 / login | pausa de 10 min (**sin reintentos**)       | sigue                  |

- Los ~20 s pedidos no son alcanzables de forma legítima: `chrome.alarms` tiene un mínimo de
  30 s en MV3 y no se usan trucos de keep-alive.
- Sin sesión se sigue sincronizando cada 120 s para que el snapshot esté fresco cuando pulses
  "Iniciar sesión".

## 9. Recuperación tras desconexión

- El estado vive en `chrome.storage.local`. Un service worker dormido, un navegador cerrado o el
  PC suspendido simplemente reanudan en la siguiente alarma o en `onStartup`.
- Si el último battlelog tiene más de 3 intervalos, se activa el modo **recovery**:
  - `collectMatchesSince` recorre como máximo 3 páginas hasta encontrar un `replay_id` que
    devuelve el tracker (`knownReplayIds`: los últimos 50 de la DB, que es la autoridad);
  - si no lo encuentra → `gapSuspected: true` en el payload y en el log. Nunca se oculta.
- Con el ordenador apagado no hay tracking. Al volver se recuperan hasta 30 replays.
- La red caída solo marca el tracker como "desconectado"; el siguiente ciclo vuelve a
  conectarlo.

## 10. Instalación local

```bash
pnpm install
pnpm db:migrate
pnpm companion:build
```

1. Chrome o Edge → `chrome://extensions` (o `edge://extensions`) → **Modo desarrollador** →
   **Cargar descomprimida** → `apps/companion-extension/dist`.
2. Para desarrollo: `pnpm companion:dev` (recompila al guardar) y luego "Recargar" en la página de
   extensiones.

## 11. Probar la conexión con Buckler

1. Inicia sesión en Buckler's Boot Camp **a mano** en ese mismo navegador.
2. Abre una pestaña de `https://www.streetfighter.com/6/buckler/profile/<tu CFN>`. Solo hace falta
   si el transporte que funciona es de pestaña.
3. En el popup, ya vinculado (o con el CFN introducido a mano): **Probar conexión con Buckler**.
   - Prueba `service_worker`, `isolated_tab` y `main_tab`, en ese orden, una vez cada uno.
   - Muestra PASS/FAIL de buildId, play y battlelog, con número de personajes y replays.
   - Guarda el primer transporte que pasa entero.
   - Un 429 detiene el test entero.

## 12. Probar el sync con el tracker

1. `.env`: `SF6_PROVIDER=companion`. Reinicia `pnpm dev`.
2. Onboarding o dashboard → **Conectar Companion** → introduce el código en el popup.
3. Si aún no tienes CFN registrado:
   - introduce tu CFN en el popup;
   - espera un sync (o pulsa **Sincronizar ahora**);
   - registra el mismo CFN en el onboarding.
4. **Iniciar sesión** en el dashboard → juega una partida de Ranked. En ≤ 30 s tras aparecer en
   Buckler, la partida llega al dashboard y al overlay por SSE.

## 13. Limitaciones actuales

- **Acceso desde extensión no validado en un navegador real.** No sabemos qué contexto
  (service worker, ISOLATED o MAIN) acepta Buckler: lo decide el test manual del punto 11.
- **Cadencia:** 30 s en sesión activa, por el mínimo de `chrome.alarms`.
- **Baseline:** al pulsar "Iniciar sesión", el snapshot puede tener hasta ~2 min si no había
  sesión activa. Mitigado por la membresía por IDs y la gracia de 90 s; un snapshot de más de
  5 min impide arrancar.
- **Login:** si caduca la sesión de Buckler, la extensión muestra "Inicia sesión en Buckler" y se
  pausa 10 minutos. No hay reintento automático del login.
- **Comportamiento sin login:** la respuesta de `_next/data` sin sesión no se ha capturado. Se
  detectan `__N_REDIRECT`, el 403 de la app ("must log in") y el 403 de CloudFront, pero falta
  confirmarlo con red real.
- **Dueño del snapshot:** un CFN solo puede alimentarlo una cuenta a la vez; la toma de control
  exige 24 h de inactividad. No hay verificación fuerte de propiedad del CFN; el
  `viewerOwnsProfile` (`is_my_data`) solo se muestra en el test.
- **Rate limiter en memoria por proceso** (como el resto del proyecto).
- **Fuera de alcance:** Chrome Web Store, firma, auto-update, Firefox, telemetría e iconos.
- **Migración:** `0004_companion` solo añade tablas. Para revertirla:

  ```sql
  DROP TABLE companion_snapshot;
  DROP TABLE companion_pairing_code;
  DROP TABLE companion_device;
  ```

  Después hay que quitar la entrada 0004 de `drizzle/meta/_journal.json`.
