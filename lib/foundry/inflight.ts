/**
 * Acquire (or lazily create) the shared inflight Map for a Foundry stage.
 *
 * The Map lives on `globalThis` under `key` so it survives Next.js dev
 * hot-module reloads: a module-scoped Map would be recreated on every reload
 * and lose inflight tracking, allowing duplicate runs. The lazy
 * `??= new Map()` init runs at most once per `key` for the lifetime of the
 * global — this is the once-only HMR-durable behavior every stage relied on.
 *
 * `name` is a debug label only. It MUST NOT drive `globalThis` property access
 * — deriving the property key from the label would risk a silent second Map
 * from a naming mismatch. The literal `key` is passed per call site so each
 * stage keeps its exact existing global name byte-for-byte.
 *
 * No global type augmentation is added; `globalThis` is cast locally instead.
 * Generic defaults match every existing call site (`Map<string, Promise<void>>`),
 * so no site needs explicit type arguments. This is side-effect-free beyond the
 * existing lazy Map init: it writes nothing to the event log and performs no
 * console output.
 */
export function createInflightMap<K = string, V = Promise<void>>(
  name: string,
  key: string,
): Map<K, V> {
  const store = globalThis as typeof globalThis & Record<string, Map<K, V> | undefined>;
  return (store[key] ??= new Map<K, V>());
}
