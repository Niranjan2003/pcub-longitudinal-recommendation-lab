export type CommandName =
  | 'create_session'
  | 'recommend'
  | 'feedback'
  | 'end_session'
  | 'compare';

/**
 * One key per application command. A deliberate new user action always gets a
 * new key; the same key is only ever reused by user-initiated recovery of the
 * identical request body.
 */
export function newIdempotencyKey(command: CommandName): string {
  const key = `pcubfe-v1:${command}:${crypto.randomUUID()}`;
  if (key.length > 128) throw new Error('Idempotency key exceeds 128 characters');
  return key;
}
