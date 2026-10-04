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
- **Orígenes del tracker cerrados:** la extensión solo habla con los orígenes de su compilación
  (§4); el popup no admite URLs arbitrarias. `/api/companion/*` responde además CORS `*` sin
  credenciales (la autenticación es por Bearer, nunca por cookie), como defensa adicional; la vía
  de acceso de la extensión es su `host_permission`, no CORS.
- **Logs:**
  - eventos: `companion_paired`, `companion_sync`, `companion_sync_rejected`,
    `companion_device_revoked`, `companion_buckler_error`, `companion_buckler_test`;
  - sin payloads, sin nombres de rivales y sin tokens.
- **Sin evasión:** no hay Playwright, Selenium, stealth, hacks de webdriver, UA falso, proxies,
  captchas ni bypass.

## 4. Permisos de la extensión

| Permiso                                                               | Motivo                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host_permissions: https://www.streetfighter.com/6/buckler/*`         | `fetch` a Buckler con la sesión del navegador, inyectar en pestañas de Buckler y encontrarlas (`tabs.query` por URL sin el permiso `tabs`)              |
| `host_permissions: <origen del tracker>/*` (uno por origen permitido) | `fetch` del service worker a `/api/companion/*`. Desarrollo: `http://localhost:3000/*` y `http://127.0.0.1:3000/*`; producción: solo tus orígenes https |
| `storage`                                                             | `chrome.storage.local`: device token, estado y caché de IDs                                                                                             |
| `alarms`                                                              | Despertar el service worker cada 30 s, sin trucos de keep-alive                                                                                         |
| `scripting`                                                           | Transportes `isolated_tab` y `main_tab` (`chrome.scripting.executeScript`)                                                                              |

- **Sin permisos de** `cookies`, `tabs`, `webRequest` ni `<all_urls>`.
- **Tracker — corrección:** la versión anterior de este documento decía que el tracker no
  necesitaba permiso de host. En MV3 el service worker solo tiene garantizado el acceso a los
  orígenes para los que tiene `host_permissions`; sin ellos todo depende de CORS y de políticas
  del navegador (p. ej. Local Network Access con `localhost`). Ahora cada origen del tracker es un
  permiso de host exacto.
- **Lista cerrada, decidida al compilar** (`src/lib/tracker-origins.ts`):
  - `pnpm companion:build` (desarrollo): `http://localhost:3000` y `http://127.0.0.1:3000`, más los
    que añada `COMPANION_TRACKER_ORIGINS`;
  - `COMPANION_TRACKER_ORIGINS=https://tracker.example.com pnpm companion:build:prod`
    (producción): **solo** esos orígenes, que deben ser https; sin la variable, la compilación
    falla;
  - se rechazan comodines, rutas, credenciales en la URL y http fuera de loopback;
  - el popup muestra un selector con esos orígenes y el service worker rechaza cualquier otro
    (`tracker_origin_not_allowed`).
- **Descartado:** `optional_host_permissions` + `chrome.permissions.request`. Exigiría declarar un
  patrón amplio (`https://*/*`) solo para poder pedir el origen en tiempo de ejecución; la lista
  cerrada es más simple y más segura para un tracker con dominio conocido.
- **CSP:** `script-src 'self'`; todo va empaquetado. Zod usa `jitless`, así que no hay `eval` ni
  `new Function` (verificado en el bundle).

## 5. Pairing

1. Dashboard → consola → **SF6 Session Companion** → **Conectar Companion**. Aparece
   `XXXX-XXXX`, válido 10 minutos y un solo uso.
2. Popup de la extensión: elige el tracker (solo los orígenes de la compilación), introduce el
   código y el nombre del dispositivo → **Conectar**.
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
3. **Tras cada recompilación, recarga la extensión** (botón ⟳ en `chrome://extensions`): Chrome no
   relee `manifest.json` ni el service worker hasta entonces. Si cambian los permisos de host,
   puede pedir confirmación.
4. Producción: `COMPANION_TRACKER_ORIGINS=https://tu-tracker.example.com pnpm companion:build:prod`.
   Un pairing hecho contra un origen que ya no está en la lista queda en error
   (`tracker_origin_not_allowed`) y hay que volver a vincular.

## 10b. Idioma (locale) de Buckler

- **Contexto:** Buckler es Next.js con i18n. Los `_next/data` llevan el locale de la página:
  `/_next/data/{buildId}/{locale}/profile/{cfn}/play.json?sid={cfn}`.
  - El HAR se capturó en inglés (`locale: "en"`, que es el valor por defecto), de ahí el `/en/`
    original.
  - Locales declarados por la página: en, ja-jp, fr, de, it, es-es, ru, pl, pt-br, ko-kr,
    zh-hant, zh-hans, ar, es-us.
- **Cómo se obtiene el locale:** siempre de la propia página, nunca se adivina.
  - **Transportes de pestaña:** `__NEXT_DATA__.locale` de la pestaña abierta, o el segmento de
    `location.pathname` (`/6/buckler/es-es/…`). El script inyectado devuelve solo
    `{buildId, locale, defaultLocale, locales}` y la ruta, nunca el `__NEXT_DATA__` completo.
  - **Service worker:** el `__NEXT_DATA__.locale` del HTML del perfil, pedido sin prefijo para que
    el servidor responda en el idioma del usuario.
- **Fallback:** como máximo el locale de la página y después `en` (el idioma por defecto de
  Buckler), y solo ante una señal explícita de desajuste. Nunca se recorre una lista de idiomas.
- **Clasificación de errores, solo por estructura:**
  - el texto "must log in" **no** sirve: es una traducción (`[t]not_registered_register`)
    presente en todas las páginas y JSON de Buckler, incluso con sesión iniciada; por eso antes
    todo error salía como `login_required`;
  - `__N_REDIRECT` hacia auth/login → `login_required`;
  - `__N_REDIRECT` hacia otro locale → `locale_mismatch`;
  - 403 con la página de la app (`__NEXT_DATA__`) → `login_required`;
  - 403 sin ella (CloudFront) → `blocked`;
  - 429 → `rate_limited`;
  - 400 pidiendo un locale distinto del de la página → `locale_mismatch`;
  - cualquier otro caso → `invalid_response`.
- **Diagnóstico del test:** muestra el locale de la página, el locale pedido y una firma segura de
  la respuesta fallida: estado, content-type, bytes, **nombres** de claves JSON y de `pageProps`,
  ruta de redirect sin query y título HTML. Nunca valores, cuerpos ni cookies.
- **Fixtures:** `profile-1733837998-es-es.html` es **derivado** de la captura en inglés (solo
  cambia `__NEXT_DATA__.locale`), no es una captura real.

## 10c. Respuestas 400 de `_next/data` (prueba real, 2026-10-04)

- **Lo observado:** en Chrome con sesión iniciada, `play.json` respondió **400** con JSON que
  tiene la forma de página de Buckler:
  - `keys[pageProps,__N_SSP]`;
  - `pageProps[fighter_banner_info, play, sid, …, __namespaces]`.
- **Medido con el HAR:** las partes fijas del `pageProps` (traducciones ~18,9 KB, banner ~2,9 KB,
  listas) suman ~22,9 KB.
  - El 400 pesó 23.174 B en `en`, así que `play` ocupa unos **260 B**, frente a 242 KB en un
    `play.json` real.
  - Es decir: el 400 trae el "envoltorio" de la página pero **no los datos**.
- **Causa del 400:** sin confirmar. No hay evidencia de por qué Buckler responde así.
  - Única diferencia de aplicación entre nuestra petición y la del propio sitio (HAR): el router
    de Next.js de Buckler envía `x-nextjs-data: 1` y el companion no lo hacía. Las demás
    cabeceras las pone el navegador.
  - Ahora se envía en todo `_next/data`. Es la cabecera del protocolo de datos de Next.js, no una
    cabecera de identidad; el cliente de servidor ya la usaba.
  - Si con ella sigue el 400, la firma del test mostrará las claves y los tamaños dentro de `play`
    y los códigos numéricos.
- **Regla de aceptación:**
  - 200 → debe pasar el esquema del endpoint;
  - 400 → se acepta **solo** si pasa el mismo esquema (`play`: `character_league_infos` válidos y
    `sid` = CFN; `battlelog`: sobre válido, `sid` = CFN y **todos** los replays válidos), y se
    registra `buckler_non_200_valid_payload` (estado, endpoint, transporte, locale; nunca el
    body);
  - 401, 403, 404, 429, 3xx y 5xx → nunca se aceptan, sea cual sea el body.

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

- **Bug corregido (pairing → "Error: network"):** el cliente del tracker llamaba a `fetch` como
  método (`this.fetchImpl(...)`). En el navegador eso lanza `Illegal invocation`; en Node no, por
  eso los tests no lo vieron. Ahora un test emula la regla del navegador. Ese error se mostraba
  como `network`; ahora el popup indica el origen inalcanzable y el service worker registra el
  detalle (`companion_tracker_unreachable`, sin datos sensibles).

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
