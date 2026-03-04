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
- **Al eliminar un patch** (porque upstream lo incorporó): mueve la entrada
  a la sección `## Patches eliminados` con fecha y motivo.

---

## Plantilla para nuevas entradas

```
### [ID] Nombre descriptivo del patch
- **Estado:** activo | merged-upstream | eliminado
- **Fecha:** YYYY-MM-DD
- **Motivación:** Por qué lo necesitamos / qué problema resuelve
- **Archivos modificados:**
  - `src/foo/bar.ts` — qué se cambió en este archivo
- **Riesgo de conflicto:** bajo | medio | alto
- **Zona de conflicto:** qué funciones/tipos concretos pueden colisionar
- **Notas de merge:** (vacío hasta que ocurra un conflicto)
- **PR upstream:** (enlace si se abrió PR al upstream)
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
| Servidor               | Contabo VPS 10 · `62.169.16.122`                                              |
| Fuentes en servidor    | `/opt/openclaw-src`                                                           |
| Binario global         | `/usr/lib/node_modules/openclaw`                                              |
| Script de update       | `manbotlo-config/scripts/update-openclaw-fork.sh`                             |

---

## Patches activos

> Aún no hay patches de código. El fork está limpio sobre el upstream `2026.3.3`.
> Las próximas secciones se irán rellenando conforme se añadan cambios.

---

### [P3] Context pre-hydration en cron isolated-agent

- **Estado:** pendiente (próximo a implementar)
- **Fecha:** —
- **Motivación:** Los agentes gastan tokens "descubriendo" información que el
  sistema ya puede obtener determinísticamente antes de arrancar el loop LLM.
  Inspirado en el patrón Stripe Minions: ejecutar comandos deterministas antes
  del loop del agente e inyectar los resultados como contexto inicial.
  FifaEye ejecuta `gh pr list` y `grep ERROR` dentro del loop de agente,
  cuando podrían ser pasos previos sin coste de tokens LLM.
- **Archivos a modificar:**
  - `src/cron/types.ts` — añadir campo opcional `preContext` en
    `CronAgentTurnPayloadFields`
  - `src/cron/isolated-agent/run.ts` — ejecutar `preContext` antes de lanzar
    el agente, reemplazar `{{id}}` en el mensaje con el output de cada comando
- **Riesgo de conflicto:** medio
- **Zona de conflicto:**
  - `types.ts`: type `CronAgentTurnPayloadFields` — el upstream puede añadir
    campos nuevos en el mismo bloque; merge suele ser trivial si son campos
    distintos
  - `run.ts`: función `runCronIsolatedAgentTurn` — zona de construcción de
    `commandBody` (~línea donde se construye el prompt); el upstream puede
    modificar esa misma zona para otros features
- **Notas de merge:** (pendiente)
- **PR upstream:** (pendiente — se abrirá cuando esté implementado y probado)
- **Referencia:** `docs/propuesta-stripe-minions.md` en repo
  `AlbertoBuenoLamana/openclaw` · PR #3

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
  - `types.ts`: mismo riesgo que P3 pero en zona distinta (nuevo tipo, no
    modifica los existentes)
  - `run.ts`: solo añade un `if/else` en el dispatch; riesgo bajo si upstream
    no reestructura el dispatch
  - `blueprint-runner.ts`: archivo nuevo, sin riesgo de conflicto
- **Zona de conflicto:** función de dispatch en `run.ts` (~primera línea del
  body de `runCronIsolatedAgentTurn` donde se decide el tipo de payload)
- **Notas de merge:** (pendiente)
- **PR upstream:** (se abrirá tras P3 — el código TS ya es el PR)
- **Referencia:** `docs/propuesta-stripe-minions.md` · PR #3

---

## Patches eliminados

> Ninguno por ahora. Cuando un patch sea incorporado por el upstream, se moverá
> aquí con fecha y SHA del commit upstream que lo incorporó.

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

# Hacer merge del upstream (ejecutar update-openclaw-fork.sh en vez de esto)
git merge upstream/main --no-edit

# Ver diff de un archivo nuestro vs upstream
git diff upstream/main -- src/cron/types.ts

# Ver todos los archivos que difieren del upstream
git diff --name-only upstream/main..HEAD
```
