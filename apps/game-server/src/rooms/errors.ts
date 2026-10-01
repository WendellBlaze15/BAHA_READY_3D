/**
 * Matchmaking rejections (static onAuth / onCreate). Colyseus returns these as the HTTP status
 * of the matchmake request, so they must stay in the 4xx range; the client maps the `message`
 * key to a friendly bilingual text.
 */
export const AuthCode = {
  BAD_OPTIONS: 422,
  UNAUTHORIZED: 401,
  NOT_ELIGIBLE: 403,
  BAD_ORIGIN: 403,
  OUTDATED_CLIENT: 426,
  SURVIVAL_DISABLED: 423,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
} as const;

/** WebSocket join errors and close codes (onJoin / client.leave / disconnect): 4xxx app range. */
export const RoomCode = {
  KICKED: 4001,
  LOBBY_IDLE: 4002,
  ELIGIBILITY_LOST: 4003,
  FORCE_CLOSED: 4004,
  ALREADY_STARTED: 4006,
  DUPLICATE_SESSION: 4009,
  SERVER_SHUTDOWN: 4099,
} as const;
