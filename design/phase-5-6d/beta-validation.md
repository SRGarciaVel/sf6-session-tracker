# Fight Session beta: manual validation with volunteer streamers

This is a lightweight checklist for the project owner to run with **a small number of
volunteer streamers** who are already on the `FIGHT_SESSION_UI_USERS` allowlist. Nobody is
recruited or contacted automatically, and no feedback is pre-filled: every result comes from a
real session.

## Before the session

- **Consent:**
  - Ask the streamer, explicitly, whether they want to take part.
  - Tell them what will be noted: task results and comments, never their stream VOD, chat,
    CFN credentials or Buckler cookies.
  - Only take notes they agree to, and let them stop at any time.
- **Privacy:**
  - Keep notes without the streamer's email, CFN id or account id. A pseudonym such as
    «Streamer A» is enough.
  - Delete the notes when the beta decision is made.
- **Setup:**
  - Add their `auth_user.id` to `FIGHT_SESSION_UI_USERS` and restart (see
    `docs/fight-session-rollout.md`).
  - Make sure they know the fallback `/dashboard?ui=classic`.
- **Observation:** let them do each task **without help first**. Note where they hesitate
  before explaining anything.

## Tasks

For each task, mark **Done**, **Done with help** or **Blocked**, and note what they said.

| #   | Task                                                 | What «done» looks like                                                                |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Connect the Companion (or confirm it is connected)   | Companion module shows «Conectado» and the device in «Navegadores vinculados»         |
| 2   | Tell whether SST can track a session right now       | They read «Seguimiento» correctly (e.g. «Listo para registrar» / «Requiere atención») |
| 3   | Start a session                                      | They find «Iniciar sesión de juego» without searching; LIVE appears                   |
| 4   | Find an overlay and open its configuration           | They reach the builder from «Configurar»                                              |
| 5   | Copy the OBS URL and add/refresh it in OBS           | The browser source shows the overlay; «✓ Copiado» was noticed                         |
| 6   | Play one or more Ranked matches                      | The match appears in LIVE without reloading                                           |
| 7   | Confirm live updates (scoreboard, last match, MR/LP) | They trust what they see; a «pendiente» MR/LP is understood                           |
| 8   | End the session                                      | Two-step end understood; no accidental end                                            |
| 9   | Explain the RECAP in their own words                 | W/L, % and per-character MR/LP change read correctly                                  |
| 10  | Start another session                                | «Preparar otra sesión» → PREPARE with «Tu última sesión»                              |

## What to record

- **Confusing labels:** the exact words that caused doubt and what they expected instead.
- **Unexpected behaviour:** what happened, when (local time), and on which screen.
- **Perceived responsiveness:** the time between a match ending and LIVE updating («instant»,
  «a few seconds», «too slow»), and the moment they noticed.
- **Missing information:** what they looked for and did not find.
- **OBS compatibility:**
  - OBS version and OS;
  - the source size used;
  - whether the overlay rendered, updated and survived scene switches.
- **Device:** desktop or mobile, browser, window size, and any enlarged text or zoom.

## Optional feedback template

```text
Streamer: «Streamer A» (pseudonym)    Date: ____    Consent to notes: yes / no
Setup: OS ____  Browser ____  OBS ____  Device: desktop / mobile  Text size/zoom: ____

Task results (Done / Done with help / Blocked + note):
 1 Companion ____   2 Tracking state ____   3 Start ____   4 Configure ____
 5 Copy OBS URL ____   6 Play ____   7 Live updates ____   8 End ____
 9 Recap ____   10 Start another ____

Confusing labels:
Unexpected behaviour (time, screen):
Responsiveness (match end → LIVE):
Missing information:
OBS notes:
Would you keep using the new interface? yes / no / not sure — why:
```

## After the session

- If any task is **Blocked**, open an issue with the notes (no personal data) before widening
  the beta.
- If they prefer the classic interface, remove their id from `FIGHT_SESSION_UI_USERS` and
  restart. Nothing else changes for them.
