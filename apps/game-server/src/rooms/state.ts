import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Synced room state (Section 18.5). Small, frequently changing values only; big or private
 * data goes through messages. A player's full bag is a `.view()` field: only that player's
 * StateView receives it — teammates see weight/slot counts.
 */
export const BagSlot = schema(
  {
    item: t.string(),
    qty: t.uint16(),
    /** −1 = not a tool. */
    durability: t.int16(),
  },
  'BagSlot',
);
export type BagSlot = SchemaType<typeof BagSlot>;

export const PlayerState = schema(
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
    /** JSON avatar config (AvatarConfig keys only, validated short tokens — no free text). */
    avatar: t.string(),
    /** Own bag only (StateView); kept in the first 32 fields for the fast filter path. */
    bag: t.array(BagSlot).view(),

    // In-run (Phase 5)
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    rotY: t.float32(),
    anim: t.string(),
    /** alive | downed | dead | disconnected */
    life: t.string(),
    health: t.uint8(),
    hunger: t.uint8(),
    thirst: t.uint8(),
    warmth: t.uint8(),
    energy: t.uint8(),
    /** Short-term sprint bar (0–100) and its "Hingal" lockout. */
    stamina: t.uint8(),
    hingal: t.boolean(),
    sprinting: t.boolean(),
    /** Comma-separated status effects. */
    effects: t.string(),
    hand: t.string(),
    body: t.string(),
    feet: t.string(),
    weight: t.float32(),
    slotsUsed: t.uint8(),
    /** Active hold: '' | loot | craft, and when it completes (sim seconds). */
    channel: t.string(),
    channelEndsAt: t.float32(),
    // Phase 6
    bleedOutAt: t.float32(),
    protectedUntil: t.float32(),
    spectator: t.boolean(),
    rescued: t.boolean(),
    onBoat: t.boolean(),
    sleeping: t.boolean(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const DropState = schema(
  { item: t.string(), qty: t.uint16(), x: t.float32(), z: t.float32() },
  'DropState',
);
export type DropState = SchemaType<typeof DropState>;

export const CampState = schema(
  {
    level: t.uint8(),
    workbenchTier: t.uint8(),
    fireLit: t.boolean(),
    /** Comma-separated built structures. */
    structures: t.string(),
    /** Next upgrade: work progress 0–1 and materials deposited so far. */
    upgradeProgress: t.float32(),
    upgradeDeposited: t.map('uint16'),
  },
  'CampState',
);
export type CampState = SchemaType<typeof CampState>;

export const NpcState = schema(
  { x: t.float32(), z: t.float32(), state: t.string(), followUserId: t.string() },
  'NpcState',
);
export type NpcState = SchemaType<typeof NpcState>;

export const CrateState = schema({ x: t.float32(), z: t.float32() }, 'CrateState');
export type CrateState = SchemaType<typeof CrateState>;

export const BoatState = schema(
  {
    /** Completed stages (0–6). */
    stage: t.uint8(),
    progress: t.float32(),
    deposited: t.map('uint16'),
    tripDepartAt: t.float32(),
    tripArriveAt: t.float32(),
  },
  'BoatState',
);
export type BoatState = SchemaType<typeof BoatState>;

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
    players: t.map(PlayerState),

    // World (Phase 5)
    simTime: t.float32(),
    day: t.uint8(),
    minute: t.float32(),
    dayPhase: t.string(),
    weather: t.string(),
    waterLevel: t.float32(),
    paused: t.boolean(),
    /** Loot point ids that have been opened (positions come from the shared map). */
    lootOpened: t.map('boolean'),
    /** Chop target id → chops left. */
    chops: t.map('uint8'),
    drops: t.map(DropState),
    /** Shared camp storage: item → qty (team-visible). */
    storage: t.map('uint16'),
    camp: CampState,

    // Objectives (Phase 6)
    boat: BoatState,
    npcs: t.map(NpcState),
    crates: t.map(CrateState),
    /** none | incoming | arriving | lifting | done */
    heli: t.string(),
    heliAt: t.float32(),
    signalActive: t.boolean(),
    secondWindsLeft: t.uint8(),
    // Team vote (kick / abandon)
    voteType: t.string(),
    voteTarget: t.string(),
    voteYes: t.uint8(),
    voteNo: t.uint8(),
    voteNeeded: t.uint8(),
    voteEndsAt: t.number(),
  },
  'SurvivalState',
);
export type SurvivalState = SchemaType<typeof SurvivalState>;
