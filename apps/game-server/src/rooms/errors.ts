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

/**
 * WebSocket join errors and close codes (onJoin / client.leave / disconnect). 41xx so they never
 * collide with Colyseus codes (4000–4003 and 4010 "may try reconnect" are reserved by the SDK).
 */
export const RoomCode = {
  KICKED: 4101,
  LOBBY_IDLE: 4102,
  ELIGIBILITY_LOST: 4103,
  FORCE_CLOSED: 4104,
  ALREADY_STARTED: 4106,
  DUPLICATE_SESSION: 4109,
  RUN_ABANDONED: 4110,
  SERVER_SHUTDOWN: 4199,
} as const;
