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

- **Estado:** pendiente (fase 3 del roadmap)
- **Fecha:** —
- **Motivación:** Los payloads de cron actuales son texto libre. El agente
  puede saltarse pasos, reordenarlos o ignorarlos. HighBot hizo timeout (600s)
  probablemente por no seguir un flujo óptimo. La idea es alternar nodos
  `deterministic` (bash sin LLM) con nodos `agent` (loop creativo) de forma
  obligatoria, como hacen los "Minions" de Stripe: "El sistema corre el modelo,
  no al revés."
- **Archivos a modificar:**
  - `src/cron/types.ts` — nuevo tipo de payload `kind: "blueprint"` con array
    de nodos `BlueprintNode[]`
  - `src/cron/isolated-agent/run.ts` — dispatch: `if kind === "blueprint"` →
    llamar al nuevo runner
  - `src/cron/isolated-agent/blueprint-runner.ts` — **archivo nuevo** (~200-300
    líneas): iterar nodos, ejecutar deterministas con `child_process.exec`,
    lanzar agente para nodos `agent`, gestionar `condition`, `maxRetries`,
    `onFail: abort|next`, notificar en abort
- **Riesgo de conflicto:** bajo-medio
  - `types.ts`: nuevo tipo union, no modifica los existentes → riesgo bajo
  - `run.ts`: solo añade un `if/else` en el dispatch → riesgo bajo si upstream
    no reestructura el dispatch
  - `blueprint-runner.ts`: archivo nuevo → sin riesgo de conflicto
- **Zona de conflicto:** inicio de `runCronIsolatedAgentTurn` donde se inspecciona
  `params.job.payload.kind`
- **Notas de merge:** (pendiente)
- **Referencia:** `docs/propuesta-stripe-minions.md` · PR #3

---

## Patches eliminados

> Ninguno por ahora.

---

## Historial de merges con upstream

| Fecha      | SHA upstream mergeado | Versión  | Conflictos             | Resolución |
| ---------- | --------------------- | -------- | ---------------------- | ---------- |
| 2026-03-04 | `7b5e64ef2`           | 2026.3.3 | ninguno (fork inicial) | —          |

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
```
