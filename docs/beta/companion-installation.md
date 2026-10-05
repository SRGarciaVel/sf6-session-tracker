# Instalar SST Companion para Street Fighter 6 (beta cerrada)

Esta guía es para testers de la beta. No hace falta saber programar: solo descargar un archivo,
descomprimirlo y hacer unos clics en el navegador. ¿Prefieres la versión corta? Mira
[QUICKSTART.md](QUICKSTART.md).

**Qué necesitas**

- Un PC con **Google Chrome**, **Brave** o **Microsoft Edge** (otros navegadores, como Firefox o
  Safari, no están soportados).
- Tu cuenta de Capcom ID con acceso a **Buckler's Boot Camp**
  (<https://www.streetfighter.com/6/buckler/>).
- El archivo ZIP de la beta que te envió el organizador.

**La beta de SST está en:** <https://sf6-session-tracker-web.onrender.com>

La extensión ya viene configurada para esa dirección: no tienes que escribir ni cambiar ninguna
URL.

---

## Qué hace el Companion con tus datos

- Lee tus datos de Buckler **desde tu propio navegador**, con la sesión que tú abriste.
- **No** envía tus cookies de Capcom.
- **No** envía tu contraseña de Capcom (la extensión nunca la ve).
- **No** usa el permiso `cookies` del navegador.
- A SST solo le envía lo necesario, ya normalizado: tu CFN ID, tu nombre de
  luchador, tus personajes con su rango/LP/MR y tus partidas (ID de la repetición, hora, modo,
  resultado, y nombre, personaje y rango del rival).

Detalle técnico completo: [docs/companion.md](../companion.md).

---

## 1. Descargar y comprobar el archivo

1. Abre <https://sf6-session-tracker-web.onrender.com/help/companion> y pulsa
   **↓ Descargar Companion**. Ese botón (y este enlace directo) dan **siempre la última versión**:

   <https://github.com/SRGarciaVel/sf6-session-tracker/releases/latest/download/sf6-session-companion-beta.zip>

   El archivo se llama `sf6-session-companion-beta.zip` (los ZIP antiguos que te pasaron por
   mensaje se llaman `sf6-session-companion-v0.1.0-beta.zip`; funcionan igual). Si el archivo
   no termina en `.zip`, **no lo instales** y pregunta al organizador.

2. _(Opcional, recomendado)_ Comprueba que el archivo es exactamente el original. El
   **SHA-256** está en la página de descarga (enlace «SHA-256») y en las notas de la release: un
   código de 64 letras y números. Calcula el del archivo descargado y compáralo. Deben ser
   idénticos.
   - **Windows** (PowerShell, en la carpeta de Descargas):
     `Get-FileHash .\sf6-session-companion-beta.zip -Algorithm SHA256`
   - **macOS:** `shasum -a 256 sf6-session-companion-beta.zip`
   - **Linux:** `sha256sum sf6-session-companion-beta.zip`

   Mayúsculas y minúsculas no importan.

## 2. Descomprimir en una carpeta permanente

1. Descomprime el ZIP. En Windows: clic derecho → **Extraer todo…**
2. Guarda la carpeta resultante en un sitio **donde vaya a quedarse**, por ejemplo
   `Documentos\SST Companion`. **No la borres ni la muevas** después de instalar: el
   navegador carga la extensión desde esa carpeta.
3. Abre la carpeta y comprueba que dentro ves directamente el archivo **`manifest.json`**,
   junto a `background.js`, `popup.html` y la carpeta `_locales`.

> Si al abrir la carpeta ves **otra carpeta** dentro, entra en ella: la carpeta correcta es la
> que contiene `manifest.json`.

## 3. Instalar la extensión

1. Abre la página de extensiones de tu navegador. Escribe esta dirección en la barra de
   direcciones y pulsa Enter:

   | Navegador | Dirección             |
   | --------- | --------------------- |
   | Chrome    | `chrome://extensions` |
   | Brave     | `brave://extensions`  |
   | Edge      | `edge://extensions`   |

2. Activa el **Modo desarrollador** (_Developer mode_):
   - **Chrome y Brave:** interruptor arriba a la derecha.
   - **Edge:** interruptor en el panel de la izquierda (en una ventana estrecha puede estar
     dentro del menú ☰).
3. Pulsa **Cargar descomprimida** (_Load unpacked_). En Edge, **Cargar desempaquetada**.
4. Selecciona **la carpeta que contiene `manifest.json`** (paso 2.3) y acepta.
5. Aparece la tarjeta **SST Companion para Street Fighter 6**, versión `0.1.0` o la que corresponda.
6. **Fija la extensión** para tenerla a mano: pulsa el icono de la pieza de puzle 🧩, junto a la
   barra de direcciones, y luego la chincheta 📌 al lado de _SST Companion para Street Fighter 6_.

> Es normal que el navegador avise de que tienes extensiones en «modo desarrollador» (Chrome
> puede mostrarlo al arrancar). Es por cómo se instala la beta. Pulsa la opción para
> **mantener** la extensión, no para desactivarla.

## 4. Iniciar sesión en Buckler

1. En **el mismo navegador**, abre <https://www.streetfighter.com/6/buckler/>.
2. Inicia sesión **tú mismo**, con tu Capcom ID, como siempre. La extensión nunca inicia sesión
   por ti ni ve tu contraseña.

## 5. Crear tu cuenta en SST

1. Abre <https://sf6-session-tracker-web.onrender.com>.

   > La primera visita del día puede tardar **hasta un minuto**: el servidor de la beta se
   > «duerme» cuando nadie lo usa y tiene que despertar. Espera en la página de carga y no
   > recargues sin parar.

2. Pulsa **Crear cuenta** (o **Iniciar sesión** si ya tienes una).
3. Si te lo pide, introduce tu **CFN User ID**: el número de tu perfil en Buckler.

## 6. Vincular el Companion con tu cuenta

1. En el panel de SST, busca el panel **SST Companion para Street Fighter 6** y pulsa
   **Conectar Companion**.
2. Aparece un **código de vinculación**, con el formato `XXXX-XXXX`. Caduca en **10 minutos** y solo
   sirve una vez. Si caduca, genera otro.
3. Abre el Companion: pulsa su icono (el que fijaste en el paso 3.6).
4. En **Tracker**, comprueba que está seleccionado:

   ```
   https://sf6-session-tracker-web.onrender.com
   ```

   Es la única opción de esta versión.

5. Escribe el código en **Código de vinculación**. El nombre del dispositivo es opcional.
6. Pulsa **Conectar**.

## 7. Comprobar que todo funciona

1. En el Companion debe aparecer:

   ```
   Tracker: Conectado
   Buckler: Sesión iniciada
   ```

   Si Buckler dice **Inicia sesión en Buckler**, vuelve al paso 4. Si dice **Abre una pestaña de
   Buckler's Boot Camp**, abre Buckler en una pestaña y déjala abierta.

2. Pulsa **Probar conexión con Buckler**.
3. Debe aparecer **Prueba Buckler: PASS**, junto con el número de personajes y de partidas
   recientes. Si aparece **FAIL**, sigue la indicación que se muestra debajo. Si no se resuelve,
   haz una captura **del popup** (nunca de tus cookies ni de la consola) y envíala al organizador.
4. En el panel de SST deberías ver tu perfil.

## 8. Jugar

1. En el dashboard pulsa **Iniciar sesión de juego**.
2. Juega normalmente. Mantén **abierto el navegador** donde está la extensión (no hace falta que
   esté en primer plano). Cada partida nueva aparece en unos **30 segundos** después de que
   Buckler la registre.
3. Al terminar, pulsa **Finalizar sesión** en el dashboard.

---

## Cómo actualizar la beta

Cuando haya una versión nueva, el panel de SST lo dice en el bloque del Companion:
**⚡ Nueva versión disponible: vX.Y.Z**, con los botones **Descargar actualización** y **Ver
cómo actualizar**. No hace falta que nadie te pase un enlace nuevo.

1. Pulsa **Descargar actualización** (es el mismo enlace de siempre: da la última versión).
2. Descomprímelo y **reemplaza el contenido de la carpeta anterior**: misma carpeta, misma
   ubicación. Borra los archivos viejos de dentro y copia los nuevos, de modo que
   `manifest.json` siga directamente en esa carpeta.
3. Abre `chrome://extensions` (o `brave://extensions` / `edge://extensions`).
4. En la tarjeta de **SST Companion para Street Fighter 6**, pulsa **Recargar** (el icono ⟳).
5. Comprueba que la tarjeta muestra la versión nueva y abre el Companion: debería seguir
   **Conectado**. Tras la siguiente sincronización, el panel mostrará **✓ Companion
   actualizado**.

**¿Se conserva la vinculación?**

- Si **reemplazas la carpeta en la misma ruta y pulsas Recargar**, lo normal es que la extensión
  conserve su identificador y sus datos guardados (incluida la vinculación). Aun así, el
  navegador **no garantiza** esto para extensiones descomprimidas.
- Si **eliminas** la extensión y la vuelves a cargar, o la cargas **desde otra carpeta**, el
  navegador la trata como una extensión nueva: se pierden sus datos y tendrás que **vincularla
  otra vez**.

Si pierdes la vinculación, repite el paso 6 con un código nuevo. No pierdes nada importante: tus
sesiones y partidas están guardadas en SST, no en la extensión. En el dashboard
puedes **Revocar** el dispositivo antiguo.

## Desinstalar

1. En la página de extensiones, pulsa **Quitar** en _SST Companion para Street Fighter 6_.
2. Borra la carpeta.
3. En el panel de SST, revoca el dispositivo.
