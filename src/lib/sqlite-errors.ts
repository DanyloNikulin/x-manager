export function isSqliteConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('SQLITE_CONSTRAINT');
}
