/**
 * Purpose: hand components the current config from whichever source the build loaded.
 * Responsibilities: context only. It reads a ConfigSource with useSyncExternalStore;
 *   it does not choose the source (client.ts does). A plain `config` prop is
 *   wrapped in a static source.
 * Inputs: a TableConfig or a ConfigSource. Outputs: context + useTableConfig().
 * Dependencies: react, ../../api/types, ../../api/configSource.
 * Side Effects: subscribes to the source while mounted.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { staticConfigSource } from "../../api/configSource";
import type { ConfigSource } from "../../api/configSource";
import type { TableConfig } from "../../api/types";

const ConfigContext = createContext<TableConfig | null>(null);

type ConfigProviderProps = { children: ReactNode } & (
  | { config: TableConfig; store?: never }
  | { store: ConfigSource; config?: never }
);

export function ConfigProvider(props: ConfigProviderProps) {
  const { store, config: staticConfig, children } = props;
  const source = useMemo(() => store ?? staticConfigSource(staticConfig!), [store, staticConfig]);
  const config = useSyncExternalStore(source.subscribe, source.get);
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

/**
 * @throws when called outside a ConfigProvider, which would otherwise render a
 *   silently empty table.
 * @invariants the returned config is the source's current value.
 */
export function useTableConfig(): TableConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("useTableConfig must be used inside a ConfigProvider");
  return config;
}
