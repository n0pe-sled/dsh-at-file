/**
 * Snapshot-store compatibility surface. Source builds against the split
 * 0.1.2 package; build.mjs rewrites that external to a runtime fallback that
 * uses client-runtime on 0.1.1. Ambient types for the split package live in
 * `dsh-client-store.d.ts` so this checkout typechecks without it installed.
 */
export { createSnapshotStore, usesSplitClientStore } from '@deepseek-ai/dsh-client-store'
export type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
