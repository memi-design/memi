/**
 * @sarveshsea/memi-studio-types — public type surface for the Mémoire
 * Studio runtime sidecar.
 *
 * Consumed by github.com/memi-design/memi-studio's React frontend so the
 * GUI app speaks the exact event protocol the engine emits. The engine
 * itself imports the same names from src/studio/contracts/* — this
 * package re-exports those names verbatim so memi-studio doesn't need
 * to vendor the engine source.
 *
 * Re-export shape:
 *   import { ProviderRuntimeEvent, makeId, ... } from "@sarveshsea/memi-studio-types"
 *
 * The package's source files are thin re-exports of the engine's
 * src/studio/contracts/* and src/studio/state/* modules. The build
 * pipeline copies those source files into this package's src/ at
 * publish time (the publish script lives in scripts/publish-types.mjs
 * — added in a follow-up).
 */

export * from "./contracts.js";
export * from "./state.js";
export * from "./rpc.js";
