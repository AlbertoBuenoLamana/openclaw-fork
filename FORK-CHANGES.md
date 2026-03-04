# Fork Changes — AlbertoBuenoLamana/openclaw-fork

Registro de todos los cambios aplicados sobre el upstream `openclaw/openclaw`.
Cada entrada documenta **qué** se cambió, **por qué**, los **archivos tocados**
y los **posibles conflictos** a vigilar cuando se haga `git merge upstream/main`.

---

## Cómo usar este archivo

- **Antes de `git merge upstream/main`:** lee las entradas activas para saber
  qué archivos nuestros pueden colisionar con cambios del upstream.
- **Al resolver un conflicto:** añade una nota en la entrada correspondiente
  explicando cómo se resolvió.
- **Al añadir un patch nuevo:** añade una entrada nueva siguiendo la plantilla.
- **Al eliminar un patch** (porque ya no lo necesitamos): mueve la entrada
  a la sección `## Patches eliminados` con fecha y motivo.

---

## Plantilla para nuevas entradas

```
### [ID] Nombre descriptivo del patch
- **Estado:** activo | eliminado
- **Fecha:** YYYY-MM-DD
- **Motivación:** Por qué lo necesitamos / qué problema resuelve
- **Archivos modificados:**
  - `src/foo/bar.ts` — qué se cambió en este archivo
- **Riesgo de conflicto:** bajo | medio | alto
- **Zona de conflicto:** qué funciones/tipos concretos pueden colisionar
- **Notas de merge:** (vacío hasta que ocurra un conflicto)
- **Referencia:** enlace a la PR/issue/doc donde se diseñó
```

---

## Base del fork

| Campo                  | Valor                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- |
| Upstream               | `openclaw/openclaw`                                                           |
| Fork                   | `AlbertoBuenoLamana/openclaw-fork`                                            |
| SHA base (fork creado) | `7b5e64ef2` — `fix: preserve raw media invoke for HTTP tool clients (#34365)` |
| Versión base           | `2026.3.3`                                                                    |
| Fecha fork             | 2026-03-04                                                                    |

---

## Cambios de configuración activos

Cambios que **no tocan código del fork** pero son parte del mismo diseño.
No generan conflictos de merge, pero hay que recordar reaplicarlos si se
resetea la config del servidor.

---

### [P7] Métricas semanales — weekly-summary expandido

- **Estado:** activo
- **Fecha:** 2026-03-04
- **Tipo:** configuración (cron payload, no código)
- **Motivación:** El cron `weekly-summary` tenía un prompt trivial. Lo expandimos
  con métricas estructuradas: tabla de agentes (lastRunStatus, lastDurationMs,
  consecutiveErrors), PRs de la semana en ambos repos, estado de proyectos,
  y guardado en `agent-metrics.md`.
- **Archivos modificados:**
  - `~/.openclaw/cron/jobs.json` — payload del job `weekly-summary`
  - Backup en `manbotlo-config/config/crons.json`
- **Riesgo de conflicto:** ninguno

---

### [P6] PR templates — lolHighlights y fifa2026

- **Estado:** activo
- **Fecha:** 2026-03-04
- **Tipo:** configuración (archivos GitHub, no código)
- **Motivación:** Los agentes HighBot y FifaEye creaban PRs sin formato consistente.
  Un template obliga a incluir cambios, validaciones y contexto.
- **Archivos creados:**
  - `AlbertoBuenoLamana/lolHighlights/.github/PULL_REQUEST_TEMPLATE.md`
  - `AlbertoBuenoLamana/fifa2026/.github/PULL_REQUEST_TEMPLATE.md`
- **Riesgo de conflicto:** ninguno

---

### [P5] Workspace efímero — HighBot blueprint

- **Estado:** activo
- **Fecha:** 2026-03-04
- **Tipo:** configuración (cron payload convertido a blueprint)
- **Motivación:** HighBot trabajaba siempre en el mismo directorio. Si el git
  state se corrompía, la siguiente ejecución heredaba el problema. Con un clone
  en `/tmp/highbot-YYYYMMDD-HHMMSS`, cada sesión arranca limpia.
- **Archivos modificados:**
  - `~/.openclaw/cron/jobs.json` — `highbot-dev` convertido de `agentTurn` a `blueprint`
    con 6 nodos: setup(clone) → check-prs → check-issues → check-todos → plan-and-code(LLM) → cleanup(rm)
  - Backup en `manbotlo-config/config/crons.json`
- **Riesgo de conflicto:** ninguno (depende de P1 blueprints en el fork)

---

### [P4] Tool curation — deny por agente

- **Estado:** activo
- **Fecha:** 2026-03-04
- **Tipo:** configuración (`openclaw.json`, no código)
- **Motivación:** El core ya soporta `tools.deny` por agente. Añadido sin cambios
  en código: cada agente deniega las tools claramente fuera de su scope.
- **Archivos modificados:**
  - `~/.openclaw/openclaw.json` — campo `tools.deny` en cada entrada de `agents.list`
  - Backup en `manbotlo-config/config/openclaw.json`
- **Riesgo de conflicto:** ninguno

---

### [P2] Cap de reintentos — SOULs de HighBot y FifaEye

- **Estado:** activo
- **Fecha:** 2026-03-04
- **Tipo:** configuración (SOUL.md, no código TypeScript)
- **Motivación:** HighBot hizo timeout (600s) entrando en loops de fix sin
  límite. Inspirado en Stripe Minions: "Si el LLM no puede arreglarlo en 2
  intentos, un tercero no va a ayudar. Solo quema compute."
- **Archivos modificados:**
  - `~/.openclaw/agents/highbot/agent/SOUL.md` — sección `## Regla de reintentos (P2)` añadida al final: max 2 rondas fix→check, luego push de rama + announce a ManBotLo
  - `~/.openclaw/agents/fifaeye/agent/SOUL.md` — misma sección añadida
  - Backup en `manbotlo-config/souls/highbot-SOUL.md` y `fifaeye-SOUL.md`
- **Riesgo de conflicto:** ninguno (no es código del fork)
- **Referencia:** `docs/propuesta-stripe-minions.md` · PR #3

---

## Patches activos

Cambios en el **código TypeScript** del fork que se compilan y despliegan.

---

### [P3] Context pre-hydration en cron isolated-agent

- **Estado:** activo
- **Fecha:** 2026-03-04
- **Motivación:** Los agentes gastan tokens "descubriendo" información que el
  sistema ya puede obtener determinísticamente antes de arrancar el loop LLM.
  Inspirado en el patrón Stripe Minions: ejecutar comandos bash antes del loop
  del agente e inyectar los resultados como contexto inicial mediante
  placeholders `{{id}}` en el mensaje.
  Ejemplo concreto: FifaEye ejecuta `gh pr list` y `grep ERROR` dentro del
  loop de agente, cuando podrían ser pasos previos sin coste de tokens LLM.
- **Archivos modificados:**
  - `src/cron/types.ts` — campo opcional `preContext` añadido al tipo
    `CronAgentTurnPayloadFields`. Array de objetos `{ id, run, label?, timeoutMs? }`.
    Retrocompatible (campo opcional, no rompe configs existentes).
  - `src/cron/isolated-agent/run.ts` — tres cambios:
    1. Imports añadidos: `exec` de `node:child_process` y `promisify` de `node:util`
    2. Función nueva `runPreContext()` (antes del export): itera el array,
       ejecuta cada comando con `execAsync` (timeout 30s por defecto, 512 KB
       max output), reemplaza `{{id}}` en el mensaje, loga preview de 120 chars.
       Si un comando falla → lanza error y aborta el run sin gastar tokens LLM.
    3. Llamada a `runPreContext()` insertada justo después de que `commandBody`
       queda finalizado y antes del bloque `skillsSnapshot`.
- **Riesgo de conflicto:** medio
- **Zona de conflicto:**
  - `types.ts` → tipo `CronAgentTurnPayloadFields`: el upstream puede añadir
    campos en el mismo bloque. Merge casi siempre trivial (campos distintos).
    Vigilar si upstream renombra o reestructura `CronAgentTurnPayloadFields`.
  - `run.ts` → zona entre el `if (deliveryRequested)` y `const existingSkillsSnapshot`:
    si upstream inserta lógica nueva en esa misma zona habrá conflicto. También
    vigilar si upstream cambia los imports de `node:child_process`/`node:util`
    (poco probable, son Node built-ins).
- **Notas de merge:** (ninguna hasta ahora)
- **Referencia:** `docs/propuesta-stripe-minions.md` · PR #3 en
  `AlbertoBuenoLamana/openclaw`

#### Uso en crons.json

```json
{
  "payload": {
    "kind": "agentTurn",
    "message": "Revisión horaria del FIFA bot.\n\nContexto pre-cargado:\n- PRs abiertas: {{open_prs}}\n- Errores hoy: {{today_errors}}\n- Últimos errores: {{last_errors}}\n\nCon esta información, decide si hay errores nuevos no cubiertos por PRs existentes.",
    "preContext": [
      {
        "id": "open_prs",
        "run": "gh pr list --repo AlbertoBuenoLamana/fifa2026 --state open --json number,title",
        "label": "PRs abiertas en fifa2026"
      },
      {
        "id": "today_errors",
        "run": "ssh -i /root/.ssh/rpi_manbotlo manbotlo-reader@100.113.2.32 'grep -c ERROR /home/manbotlo-reader/allowed/fifa-bot/logs/fifa_bot_$(date +%Y-%m-%d).log 2>/dev/null || echo 0'",
        "label": "Conteo de errores hoy",
        "timeoutMs": 10000
      },
      {
        "id": "last_errors",
        "run": "ssh -i /root/.ssh/rpi_manbotlo manbotlo-reader@100.113.2.32 'grep ERROR /home/manbotlo-reader/allowed/fifa-bot/logs/fifa_bot_$(date +%Y-%m-%d).log 2>/dev/null | tail -20'",
        "label": "Últimos 20 errores",
        "timeoutMs": 10000
      }
    ]
  }
}
```

---

### [P1] Blueprints — motor de nodos deterministas + agente

- **Estado:** activo
- **Fecha:** 2026-03-04
- **Commits:** `edd03c26e` (v1), `470b062ce` (v2: condition, storeAs, onAbort)
- **Motivación:** Los payloads de cron actuales son texto libre. El agente
  puede saltarse pasos, reordenarlos o ignorarlos. HighBot hizo timeout (600s)
  probablemente por no seguir un flujo óptimo. La idea es alternar nodos
  `deterministic` (bash sin LLM) con nodos `agent` (loop creativo) de forma
  obligatoria, como hacen los "Minions" de Stripe: "El sistema corre el modelo,
  no al revés."
- **Archivos modificados:**
  - `src/cron/types.ts` — tipos `BlueprintNode` y `CronBlueprintPayload`;
    `CronPayload` union extendida; `CronPayloadPatch` extendida
  - `src/cron/isolated-agent/blueprint-runner.ts` — **archivo nuevo** (175 líneas):
    itera nodos, ejecuta deterministas con `child_process.exec`, lanza agente
    para nodos `agent`, gestiona `maxRetries`, `onFail: abort|continue`,
    inyecta stdout como `{{id}}` en mensajes posteriores
  - `src/cron/isolated-agent/run.ts` — import del runner + dispatch early-return
    `if payload.kind === "blueprint"` antes de cualquier setup LLM
  - `src/cron/service/jobs.ts` — branches `blueprint` en `buildPayloadFromPatch`
    y `mergeCronPayload` (dos sitios donde el upstream asumía solo `agentTurn`)
  - `src/cron/service/normalize.ts` — guard en `normalizePayloadToSystemText`
- **Riesgo de conflicto:** bajo-medio
  - `types.ts`: nuevo tipo union antes de los existentes → riesgo bajo
  - `run.ts`: `if/else` early-return en dispatch → riesgo bajo si upstream
    no reestructura el inicio de `runCronIsolatedAgentTurn`
  - `jobs.ts` y `normalize.ts`: zonas de switch/if sobre `payload.kind` →
    **vigilar si upstream añade nuevos kinds**, habría que añadir nuestro branch
  - `blueprint-runner.ts`: archivo nuevo → sin riesgo
- **Zona de conflicto:**
  - `run.ts` línea ~185 (`agentCfg` merge block) — donde se insertó el dispatch
  - `jobs.ts` función `mergeCronPayload` y `buildPayloadFromPatch`
  - `normalize.ts` función `normalizePayloadToSystemText`
- **Notas de merge:** Al hacer merge upstream vigilar `jobs.ts` — si upstream
  añade un nuevo `kind` de payload, la cadena `if/else if` puede necesitar
  el branch blueprint reinsertado
- **Referencia:** `docs/propuesta-stripe-minions.md` · PR #3

#### Formato de blueprint en crons.json

````json
{
  "payload": {
    "kind": "blueprint",
    "timeoutSeconds": 600,
    "nodes": [
      {
        "kind": "deterministic",
        "id": "open_prs",
        "run": "gh pr list --repo owner/repo --state open --json number,title",
        "label": "PRs abiertas",
        "onFail": "abort"
      },
      {
        "kind": "agent",
        "label": "Analizar y actuar",
        "message": "PRs abiertas: {{open_prs}}\n\nAnaliza y decide qué hacer.",
        "maxRetries": 1,
        "onFail": "abort"
      }
    ]
  }
}

---

## Patches eliminados

> Ninguno por ahora.

---

## Historial de merges con upstream

| Fecha | SHA upstream mergeado | Versión | Conflictos | Resolución |
|-------|-----------------------|---------|------------|------------|
| 2026-03-04 | `7b5e64ef2` | 2026.3.3 | ninguno (fork inicial) | — |

---

## Comandos útiles

```bash
# Ver qué commits del upstream no tenemos aún
git fetch upstream main
git log --oneline HEAD..upstream/main

# Ver qué commits nuestros no están en upstream
git log --oneline upstream/main..HEAD

# Hacer merge del upstream
bash scripts/update-openclaw-fork.sh   # en el servidor
# o manualmente:
git merge upstream/main --no-edit

# Ver diff de un archivo nuestro vs upstream
git diff upstream/main -- src/cron/types.ts
git diff upstream/main -- src/cron/isolated-agent/run.ts

# Ver todos los archivos que difieren del upstream
git diff --name-only upstream/main..HEAD
````
