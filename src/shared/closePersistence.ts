export type RendererClosePersistenceOutcome =
  | { status: 'saved' }
  | { status: 'failed'; error: string }
