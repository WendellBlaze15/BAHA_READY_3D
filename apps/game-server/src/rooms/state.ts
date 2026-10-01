import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Synced lobby/room state. Only what every member may see goes here; per-player private data
 * (bag contents, chat mute lists) arrives in Phase 5 behind StateView.
 */
export const LobbyPlayer = schema(
  {
    userId: t.string(),
    username: t.string(),
    /** '' until chosen; 'solo' in solo runs. */
    role: t.string(),
    ready: t.boolean(),
    connected: t.boolean(),
    isHost: t.boolean(),
    /** Join order — host transfer goes to the earliest remaining player. */
    joinedAt: t.number(),
    /** JSON avatar config (hat/accessory keys only — no free text). */
    avatar: t.string(),
  },
  'LobbyPlayer',
);
export type LobbyPlayer = SchemaType<typeof LobbyPlayer>;

export const SurvivalState = schema(
  {
    phase: t.string(), // lobby | cutscene | playing | ended
    code: t.string(),
    mode: t.string(), // solo | coop
    difficulty: t.string(),
    hostId: t.string(),
    maxPlayers: t.uint8(),
    minPlayers: t.uint8(),
    configVersion: t.uint16(),
    protocol: t.uint8(),
    /** keyed by userId */
    players: t.map(LobbyPlayer),
  },
  'SurvivalState',
);
export type SurvivalState = SchemaType<typeof SurvivalState>;
