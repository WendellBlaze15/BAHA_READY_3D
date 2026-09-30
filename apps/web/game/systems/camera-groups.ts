/**
 * Rapier collision-group masks for camera collision (same encoding as `interactionGroups`:
 * memberships in the high 16 bits, filter in the low 16 bits). Colliders default to 0xFFFFFFFF,
 * so every normal (visible) collider blocks the camera without any change.
 */

/**
 * For colliders that block the PLAYER but must not pull the camera in: invisible world bounds
 * and the diorama's open (cut-away) house wall. Member of group 0 only; still collides with
 * everything, so movement is unaffected.
 */
export const NOT_CAMERA_BLOCKING = ((1 << 16) | 0xffff) >>> 0;

/** Camera ray: member of group 15, hits only colliders that are members of group 1. */
export const CAMERA_RAY_GROUPS = (((1 << 15) << 16) | (1 << 1)) >>> 0;

/**
 * Rapier QueryFilterFlags: EXCLUDE_KINEMATIC (2) | EXCLUDE_DYNAMIC (4) | EXCLUDE_SENSORS (8).
 * Only fixed, solid geometry (walls, roofs, buildings) blocks the camera; NPCs walking past or
 * trigger zones never make it jump.
 */
export const CAMERA_RAY_FLAGS = 2 | 4 | 8;
