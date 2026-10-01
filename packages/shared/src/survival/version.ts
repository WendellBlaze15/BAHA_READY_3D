/**
 * Client ↔ game-server protocol version. Bump on any breaking change to messages or synced
 * state; the server rejects mismatched clients with a friendly "please reload" message.
 */
export const SURVIVAL_PROTOCOL_VERSION = 1;
