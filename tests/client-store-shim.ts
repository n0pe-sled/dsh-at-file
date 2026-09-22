/**
 * Test-only resolution of the harness's split client-store package.
 *
 * This checkout's harness predates the split, so tests resolve the same
 * contract through `@deepseek-ai/dsh-client-runtime/client` (mapped to source
 * by the vitest config), mirroring the bundle-time fallback in `build.mjs`.
 * `usesSplitClientStore` is false on this harness line; the plugin's runtime
 * bundle computes the same flag by probing for the split package.
 */
export { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
export type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
export const usesSplitClientStore = false
