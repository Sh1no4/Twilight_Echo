export interface PlayerStoreHmrApi {
  accept(): void
  dispose(callback: () => void): void
}

/**
 * This store exports long-lived refs which mounted Vue components retain.
 * Replacing only the module would split the UI onto the old refs and the
 * playback commands onto the new refs, so store updates require a full
 * renderer reload in development.
 */
export function configurePlayerStoreHmr(
  hot: PlayerStoreHmrApi | undefined,
  reload: () => void,
  dispose: () => void
): void {
  if (!hot) return
  // Establish a self-accepting boundary so Vite does not first propagate this
  // stateful module into every mounted component. The refresh must be requested
  // from dispose, before a replacement module can expose a second ref graph.
  hot.accept()
  hot.dispose(() => {
    dispose()
    reload()
  })
}
