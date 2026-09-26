// Stands in for vite-plugin-pwa's virtual module, which exists only in a Vite build.
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => undefined;
}
