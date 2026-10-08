/**
 * Purpose: the shape ConfigProvider reads its config from.
 * Responsibilities: define ConfigSource and the static source production uses.
 *   Imports nothing from adapter-msw, because the production bundle reaches this file.
 * Inputs: a TableConfig. Outputs: ConfigSource, staticConfigSource().
 * Dependencies: ./types (types only).
 * Side Effects: none.
 */
import type { TableConfig } from "./types";

/** Anything with a current value and change notifications; the muslin's ConfigStore satisfies it. */
export interface ConfigSource {
  get(): TableConfig;
  subscribe(listener: () => void): () => void;
}

const noop = () => {};

/** A source that never changes: get returns the same object, subscribe does nothing. */
export function staticConfigSource(config: TableConfig): ConfigSource {
  return { get: () => config, subscribe: () => noop };
}
