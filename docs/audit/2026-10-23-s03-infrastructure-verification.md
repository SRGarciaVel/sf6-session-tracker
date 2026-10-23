# S-03: verificación de la seguridad de la infraestructura de producción (2026-10-23)

Seguimiento del hallazgo **S-03** de `docs/audit/2026-10-22-performance-security-review.md`.

**Base:** `main` `b1042de`, con S-01 (Next 16.4.2) y S-02 (admisión acotada) ya mergeados.

**Método:**

- Revisión del código y la configuración del repositorio.
- Builds locales.
- Solo dos tipos de petición **pública y de solo lectura** a producción: la negociación TLS/ALPN y
  las cabeceras de `/login` y `/api/health`, más el redirect de `/dashboard` sin sesión.
- **No** se usó ninguna credencial de producción, no se consultaron datos de jugadores y no se
  cambió ningún ajuste.

Este documento es público:

- no contiene URLs de base de datos, identificadores del proyecto de Supabase, IDs de petición
  del edge ni credenciales;
- los comandos SQL del §3 solo leen **metadatos** (roles, permisos, estado TLS), nunca filas de
  jugadores.

## 1. Arquitectura relevante (cómo accede SST a la base de datos)

- **Único camino a Postgres:** el servidor de Next.js (y el tracker embebido en el mismo proceso)
  se conecta con **postgres.js** mediante `DATABASE_URL`, por el protocolo de Postgres.
  - Pool de 5 conexiones por proceso.
  - Una conexión adicional con `LISTEN` para el tiempo real.
- **SST no usa la API de Supabase:**
  - no hay `supabase-js`, ni claves `anon` o `service_role`, ni llamadas a PostgREST o GraphQL;
  - la autenticación es Better Auth, con tablas propias en `public`, no Supabase Auth.
- **El navegador nunca habla con la base de datos.** Toda la propiedad de los datos (qué cuenta
  puede ver qué) se comprueba en el servidor (`docs/security-audit.md`, IDOR) y la cubren los
  tests de integración.
- **Migraciones:** son un **paso manual** (`pnpm db:migrate`). No se ejecutan en `build` ni en
  `start`, así que el runtime puede usar un rol **sin permisos de DDL**.
- **Necesidades del runtime:**
  - `SELECT`, `INSERT`, `UPDATE` y `DELETE` sobre las tablas de `public`;
  - `LISTEN` y `pg_notify` (no requieren privilegios especiales);
  - **sin secuencias** (todos los IDs son UUID generados en la base de datos), **sin**
    `CREATE` ni `TRUNCATE`.

**Consecuencia:**

- la **Data API** de Supabase y la **RLS** no participan en el funcionamiento de SST;
- la RLS **no** es su control de acceso;
- la Data API es pura superficie expuesta si sigue activa con permisos para `anon` o
  `authenticated`.

## 2. Matriz de verificación

| #   | Control                                                            | Estado                                                                      | Evidencia / motivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Riesgo si falla                                                                                                                                     |
| --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Exposición de la Data API de Supabase                              | **Requiere confirmación del propietario**                                   | SST no usa la Data API (verificado en el código), así que desactivarla o revocar permisos **no puede romper SST**. Las migraciones no contienen ningún `REVOKE` ni RLS: el bloqueo de SEC-025 es un paso manual que no se puede comprobar desde el repositorio.                                                                                                                                                                                                                      | **CRÍTICO.** La clave `anon` es pública por diseño. Sin bloqueo, podría leer y escribir todas las tablas, incluidas las de sesiones y credenciales. |
| 2   | Rol de la app con privilegios mínimos                              | **Requiere confirmación del propietario**                                   | Es viable sin cambios de código: migraciones aparte, sin secuencias ni DDL en runtime. El rol que usa Render no es visible desde aquí.                                                                                                                                                                                                                                                                                                                                               | MEDIO. No hay inyección SQL conocida (consultas parametrizadas), pero un rol `postgres` o superusuario amplía el impacto de cualquier fallo.        |
| 3   | TLS entre la app y la base de datos                                | **Parcial: requiere confirmación**                                          | `src/server/db/client.ts` no fija `ssl`: el cifrado depende de que `DATABASE_URL` incluya `sslmode=require`, y de que Supabase lo imponga. El código no lo exige en producción.                                                                                                                                                                                                                                                                                                      | MEDIO. Tráfico de la BD sin cifrar por Internet.                                                                                                    |
| 4   | RLS                                                                | **No aplica como control principal** (ver §4)                               | El acceso es solo desde el servidor, con propiedad comprobada en la app. Habilitar RLS sin políticas, con un rol que no sea propietario ni tenga `BYPASSRLS`, **rompería SST** (lecturas vacías y escrituras rechazadas).                                                                                                                                                                                                                                                            | —                                                                                                                                                   |
| 5   | Restricciones de red de Supabase                                   | **Requiere confirmación** (endurecimiento opcional)                         | Depende de las IP de salida de Render; no se puede ver desde el repositorio.                                                                                                                                                                                                                                                                                                                                                                                                         | BAJO si 1–3 están bien.                                                                                                                             |
| 6   | Pooling y límites de conexiones                                    | **Verificado en el código; modo y puerto: confirmación**                    | 5 conexiones + 1 `LISTEN` por proceso (`client.ts`, `realtime/hub.ts`). `LISTEN/NOTIFY` y las sentencias preparadas exigen conexión **directa o en modo sesión**, nunca el pooler en modo transacción (SEC-023).                                                                                                                                                                                                                                                                     | MEDIO. En modo transacción el tiempo real (SSE) deja de funcionar.                                                                                  |
| 7   | Regiones de Render y Supabase, latencia                            | **Requiere confirmación del propietario**                                   | No se ve desde el repositorio. La auditoría midió unos **17 niveles secuenciales** de BD en el dashboard: el tiempo de render ≈ 17 × RTT, más el coste de abrir conexiones.                                                                                                                                                                                                                                                                                                          | Rendimiento (no seguridad).                                                                                                                         |
| 8   | Separación de entornos                                             | **Parcial**                                                                 | Desarrollo y tests usan Postgres local (`.env.example`; las herramientas rechazan hosts no locales). En producción, `NODE_ENV=production` rechaza secretos de ejemplo y exige `CREATOR_KEY_PEPPER` (`src/server/env.ts`). Las herramientas de desarrollo solo existen fuera de producción, con flag explícito y provider mock. Falta confirmar que ningún servicio de preview comparte la BD de producción.                                                                          | MEDIO si un entorno de pruebas escribe en producción.                                                                                               |
| 9   | Credenciales expuestas al navegador, a logs o a endpoints públicos | **Verificado seguro** (código y bundles) + revisión de logs del propietario | No hay variables `NEXT_PUBLIC_`. Ningún componente de cliente importa la configuración, la BD ni la auth del servidor. Los valores locales de `BETTER_AUTH_SECRET` y `DATABASE_URL` **no aparecen** en `.next/static` (la única coincidencia es el _nombre_ de la variable en un getter genérico de la librería cliente de Better Auth). El logger redacta claves sensibles. En producción, `/api/health` devuelve solo `{"ok":true}` y `/dashboard` sin sesión redirige a `/login`. | —                                                                                                                                                   |
| 10  | HTTP/2 para los overlays de OBS                                    | **Verificado**                                                              | El edge de producción negocia **h2 por ALPN**, con **TLS 1.3**; HTTP/1.1 queda solo como fallback para clientes que no negocian h2. OBS (CEF/Chromium) usa h2, así que varios streams SSE se multiplexan en una conexión y el límite de 6 conexiones de HTTP/1.1 (P-10) no aplica.                                                                                                                                                                                                   | —                                                                                                                                                   |
| +   | HTTPS, HSTS y cabeceras en producción                              | **Verificado**                                                              | `Strict-Transport-Security` (2 años, `includeSubDomains`), CSP, `X-Frame-Options: DENY`, COOP, `nosniff`, `Permissions-Policy` y `Referrer-Policy` en `/login`.                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                   |

## 3. Comprobaciones que debe hacer el propietario

**Reglas para estas comprobaciones:**

- No compartas en ningún sitio público ni en chats valores de `DATABASE_URL`, contraseñas, claves
  de Supabase ni el identificador del proyecto.
- Las consultas SQL siguientes son **de solo lectura sobre metadatos**. Ejecútalas en
  **Supabase → SQL Editor** del proyecto de producción.
- Donde aparece `<app_user>`, sustitúyelo por el usuario que figura en la `DATABASE_URL` de Render.
  - Con el pooler de Supabase el usuario tiene la forma `usuario.ref`; usa la parte anterior al
    punto.
  - En Render se ve en **Dashboard → servicio web → Environment → `DATABASE_URL` → reveal**. Léelo
    localmente; no lo copies a ningún sitio.

### 3.1 Data API (control 1)

1. **Supabase → Project Settings → Data API** (en versiones anteriores, **Settings → API**).
   Anota si **«Enable Data API»** está activado y qué esquemas expone (_Exposed schemas_).
2. SQL: privilegios de `anon` y `authenticated` sobre `public`. **Esperado: 0 filas.**

   ```sql
   select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
    group by grantee, table_name
    order by table_name;
   ```

3. SQL: privilegios por defecto para objetos futuros. **Esperado:** ninguna fila de `public`
   que conceda permisos a `anon` o `authenticated`.

   ```sql
   select pg_get_userbyid(defaclrole) as owner, defaclnamespace::regnamespace as schema,
          defaclobjtype as type, defaclacl as acl
     from pg_default_acl
    where defaclnamespace = 'public'::regnamespace;
   ```

4. **Opcional, desde tu propia máquina:** una petición a `https://<ref>.supabase.co/rest/v1/auth_user`
   con la cabecera `apikey: <anon>`. **Esperado: 401 o 404, nunca filas.** No pegues la respuesta
   ni la clave en ningún sitio.

### 3.2 Rol de la app (control 2)

```sql
select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolconnlimit
  from pg_roles where rolname = '<app_user>';

select has_schema_privilege('<app_user>', 'public', 'CREATE') as can_create_in_public;

select table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where grantee = '<app_user>' and table_schema = 'public'
 group by table_name order by table_name;
```

**Esperado para «mínimo privilegio»:**

- `rolsuper`, `rolcreaterole`, `rolcreatedb` y `rolreplication` a `false`;
- `can_create_in_public` a `false`;
- solo `DELETE, INSERT, SELECT, UPDATE` en cada tabla.

**Si el usuario es `postgres`:** es el comportamiento por defecto de Supabase. Funciona, pero no
es mínimo privilegio (ver §5.2).

### 3.3 TLS (control 3)

1. En **Render → Environment → `DATABASE_URL`** (lectura local): comprueba que incluye
   `sslmode=require`, o un modo más estricto.
2. **Supabase → Project Settings → Database → SSL Configuration:** «Enforce SSL on incoming
   connections» activado.
3. SQL: conexiones de la app cifradas. **Esperado: todas con `ssl = true`.**

   ```sql
   select s.ssl, s.version, count(*)
     from pg_stat_ssl s join pg_stat_activity a using (pid)
    where a.usename = '<app_user>'
    group by s.ssl, s.version;
   ```

### 3.4 Pooling (control 6)

1. En la `DATABASE_URL` (lectura local), identifica el host y el puerto:
   - **directo** (`db.<ref>…`, 5432) o **pooler en modo sesión** (puerto 5432 del pooler): correcto;
   - **pooler en modo transacción (6543): incorrecto** para SST.
2. **Supabase → Project Settings → Database → Connection pooling:** anota el _Pool size_ y el
   máximo de clientes de tu plan.
3. SQL, con la app en marcha. **Esperado:** como máximo unas 6–7 conexiones por instancia web,
   entre activas e inactivas.

   ```sql
   select state, count(*) from pg_stat_activity where usename = '<app_user>' group by state;
   ```

### 3.5 Regiones (control 7)

1. **Render → servicio web → Settings → Region.**
2. **Supabase → Project Settings → General → Region** (o _Infrastructure_).
3. **Si no coinciden:** el RTT entre regiones (por ejemplo, US West ↔ US East, unos 60–80 ms)
   multiplica el render del dashboard (≈ 17 × RTT, es decir 1–1,4 s). En ese caso conviene aplicar
   PR-3 de la auditoría (pool y finales en un solo `UPDATE`) antes de crecer, o planear la migración
   de región.

### 3.6 Separación de entornos y credenciales (controles 8 y 9)

- **Render:** lista de servicios del workspace. Confirma que **solo** el servicio de producción
  usa la `DATABASE_URL` de producción (sin previews ni crons que la compartan).
- **Render → Environment:**
  - `NODE_ENV=production`;
  - `ENABLE_DEV_TOOLS` **sin definir**;
  - `SF6_PROVIDER=companion`;
  - `FIGHT_SESSION_UI_USERS` con **solo** los ids previstos.
- **Render → Environment:** **no** debe haber claves de Supabase (`SUPABASE_*`, `anon`,
  `service_role`). SST no las usa; si existen, son un secreto innecesario.
- **Render → Logs:** busca `postgres://`, `password`, `Bearer` y `set-cookie`. **Esperado: sin
  resultados.** El logger redacta esas claves.
- **Supabase → Project Settings → API keys:** si alguna vez se compartió la clave
  `service_role`, rótala. SST no la necesita.

### 3.7 Restricciones de red (control 5, opcional)

**Supabase → Project Settings → Database → Network Restrictions.** Anota si hay restricciones.
No las actives sin leer antes el §5.4.

## 4. RLS: por qué no se recomienda «activarla sin más»

- **Activar la RLS no protege la Data API más que el bloqueo.** Revocar `anon` y `authenticated`,
  o desactivar la Data API, cierra ese camino por completo.
- **Puede romper SST:**
  - las tablas son propiedad del rol que ejecutó las migraciones;
  - si la app usa ese mismo rol, la RLS no le afecta (el propietario la ignora salvo `FORCE`);
  - si la app usa un rol distinto sin `BYPASSRLS`, una RLS sin políticas devuelve **0 filas** y
    rechaza escrituras: el dashboard, el sync y las sesiones fallarían.
- **Escribir políticas por usuario no encaja con la arquitectura:** el servidor conecta con un
  único rol, y la identidad del usuario vive en Better Auth, no en el JWT de Postgres.
- **Activar RLS sin políticas solo como defensa en profundidad** es posible, únicamente después de
  confirmar que el rol de la app es propietario o tiene `BYPASSRLS`, y con un plan de rollback
  (`alter table … disable row level security`). Beneficio marginal: **no prioritario.**

## 5. Recomendaciones seguras (solo si las comprobaciones del §3 lo requieren)

### 5.1 Bloquear la Data API (si 3.1 muestra permisos o la API activa): PRIORIDAD MÁXIMA

- **Opción A, la más simple:** **desactivar la Data API** en Supabase → Data API.
  - _Impacto en SST:_ ninguno (no la usa).
  - _Rollback:_ volver a activarla.
- **Opción B:** el SQL de SEC-025 (`docs/security-audit.md`): revocar a `anon` y `authenticated`
  en tablas, secuencias, funciones y privilegios por defecto.
  - _Impacto:_ ninguno en SST.
  - _Rollback:_ los `GRANT` inversos (solo si otra herramienta los necesitara; SST no).
- **Requisito previo:** ninguno. Hay que verificarlo después con la comprobación 3.1.

### 5.2 Rol de mínimo privilegio (si 3.2 muestra `postgres` o permisos amplios)

1. Crear un rol de login exclusivo para la app con `CONNECT` y `USAGE` en `public`, y `SELECT`,
   `INSERT`, `UPDATE` y `DELETE` en todas las tablas.
2. Configurar privilegios por defecto para que las tablas creadas por migraciones futuras
   (con el rol propietario) se concedan automáticamente al rol de la app.
3. Cambiar **solo** la `DATABASE_URL` del runtime en Render. Las migraciones siguen con el rol
   propietario, desde una máquina de confianza.

- **Prerrequisitos:**
  - **probarlo antes en un proyecto de staging**;
  - comprobar que Better Auth, el sync, las sesiones, `LISTEN/NOTIFY`, los rate limits y el PDF
    funcionan con ese rol.
- **Impacto si algo falta:** errores `permission denied` visibles en los logs.
- **Rollback:** volver a la `DATABASE_URL` anterior y redesplegar.
- **Riesgo de corte:** medio. Hacerlo en una ventana tranquila.

### 5.3 TLS obligatorio (si 3.3 muestra conexiones sin cifrar)

- Añadir `sslmode=require` a la `DATABASE_URL` de Render y activar «Enforce SSL» en Supabase.
  - _Rollback:_ quitar el parámetro.
- **Mejora de código (PR aparte, opcional):**
  - en producción, rechazar al arrancar una `DATABASE_URL` no local sin `sslmode`;
  - y, a medio plazo, `verify-full` con el certificado CA de Supabase, porque `require` cifra pero
    no valida el certificado.

### 5.4 Restricciones de red (opcional)

- **Solo** con la lista exacta de IP de salida de Render para la región del servicio (Render →
  servicio → _Connect / Outbound IPs_).
- **Riesgo:** cortar SST si la lista está incompleta o cambia, y bloquear también tus migraciones
  desde casa.
- **Rollback:** eliminar la restricción.
- **Beneficio:** defensa en profundidad. Recomendable **después** de 5.1–5.3.

### 5.5 Pooling (si 3.4 muestra el puerto 6543)

- Cambiar a la conexión directa o al pooler en **modo sesión**.
- **Síntoma actual si no se cambia:** el tiempo real no se actualiza y hay errores de sentencias
  preparadas.
- **Rollback:** la URL anterior.

## 6. Riesgos de dependencias y de caída

| Dependencia                               | Riesgo                                                                                                               | Mitigación actual / recomendada                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supabase (una sola base de datos)         | Si cae, también cae la autenticación, el sync y las sesiones. Las sesiones no se pierden: viven en la base de datos. | Al recuperarse continúa todo. El Companion reenvía las partidas (dedupe por replay). Exportar backups (Supabase → Database → Backups) y comprobar la retención del plan. |
| Render Free (un solo proceso, se duerme)  | Arranque en frío de ~1 min; un despliegue o un fallo corta web, SSE y tracker a la vez.                              | Documentado (`docs/deploy-render.md`). Al crecer, plan de pago o modo split (web + worker).                                                                              |
| Cloudflare / edge de Render               | TLS, h2 y cabeceras dependen del edge.                                                                               | Verificado hoy. Reverificar tras cambios de dominio.                                                                                                                     |
| Cambio de rol o TLS (§5)                  | Una configuración incompleta corta la app.                                                                           | Staging primero, ventana tranquila, rollback inmediato con la URL anterior.                                                                                              |
| Límite de conexiones del plan de Supabase | Varias instancias (6–7 conexiones cada una) más herramientas pueden agotarlo.                                        | Revisar 3.4 antes de escalar a varias instancias.                                                                                                                        |

## 7. Go / no-go para ampliar la beta

- **NO-GO** mientras **3.1 (Data API)** no esté confirmada como bloqueada. Es el único punto con
  impacto **crítico** posible, y se corrige en minutos sin riesgo para SST (§5.1).
- **GO para ampliar la beta de forma controlada** cuando:
  1. **3.1 confirmado:** 0 permisos para `anon` y `authenticated`, o la Data API desactivada;
  2. **3.3 confirmado:** todas las conexiones con `ssl = true`;
  3. **3.4 confirmado:** sin modo transacción;
  4. **3.6 confirmado:** sin claves de Supabase innecesarias en Render, `ENABLE_DEV_TOOLS` sin
     definir y la allowlist correcta.
- **Recomendado pero no bloqueante:**
  - 3.2 (rol de mínimo privilegio, §5.2, con staging);
  - 3.5 (si las regiones no coinciden, PR-3 antes de crecer);
  - 3.7 (restricciones de red, después).
