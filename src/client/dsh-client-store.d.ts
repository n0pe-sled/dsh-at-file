/**
 * Ambient types for the harness's split client-store package
 * (`@deepseek-ai/dsh-client-store`, 0.1.2+). This checkout predates the split,
 * where the same contract lives in `@deepseek-ai/dsh-client-runtime/client`;
 * `build.mjs` rewrites the runtime import to that module and injects
 * `usesSplitClientStore`. Declaring the module here keeps `src/client/store.ts`
 * re-exporting types that match the runtime bundle with no split package
 * installed. A global file (no top-level import/export) is required: a
 * `declare module` inside a module is an augmentation and fails when the target
 * package is absent.
 */
declare module '@deepseek-ai/dsh-client-store' {
  /** Minimal observable snapshot source. */
  export interface ObservableSnapshot<T> {
    getSnapshot(): T
    subscribe(fn: () => void): () => void
  }

  /** Writable snapshot store. */
  export interface SnapshotStore<T> extends ObservableSnapshot<T> {
    update(mutator: (draft: T) => void): void
    set(next: T): void
  }

  /**
   * Create a snapshot store.
   * @param init - initial state.
   * @param opts - flush mode and opt-in persistence.
   * @returns the store.
   */
  export function createSnapshotStore<T>(
    init: T,
    opts?: { flush?: 'raf' | 'sync'; persist?: { name: string } },
  ): SnapshotStore<T>

  /** Runtime feature flag supplied by the compatibility bundle shim. */
  export const usesSplitClientStore: boolean
}
