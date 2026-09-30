'use client';

/**
 * Unified input (keyboard WASD/arrows, virtual joystick, gamepad). Read with getInput()
 * inside useFrame — no React state per frame.
 */
const state = {
  keys: new Set<string>(),
  joy: { x: 0, y: 0 },
  look: { dx: 0 },
  interactPressed: false,
  pausePressed: false,
  jumpPressed: false,
  attackPressed: false,
  /** On-screen Sprint button held. */
  sprintTouch: false,
  /** Previous gamepad button states (edge detection). */
  padPrev: [] as boolean[],
};

let padSprint = false;

export function getInput() {
  let x = state.joy.x;
  let y = state.joy.y;
  const k = state.keys;
  if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
  if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
  if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;

  // Gamepad (standard mapping): left stick move, right stick look, A jump, X interact,
  // B attack, LT / L3 sprint, Start pause. Buttons are edge-triggered (one action per press).
  const pads =
    typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    x += dz(p.axes[0] ?? 0);
    y -= dz(p.axes[1] ?? 0);
    state.look.dx += dz(p.axes[2] ?? 0) * 6;
    const pressed = (i: number) => !!p.buttons[i]?.pressed && !state.padPrev[i];
    if (pressed(0)) state.jumpPressed = true;
    if (pressed(2)) state.interactPressed = true;
    if (pressed(1)) state.attackPressed = true;
    if (pressed(9)) state.pausePressed = true;
    state.padPrev = p.buttons.map((b) => b.pressed);
    padSprint = !!(p.buttons[6]?.pressed || p.buttons[10]?.pressed);
    break;
  }
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

/** Sprint is held (Shift, on-screen button, or gamepad LT/L3). */
export function isSprintHeld() {
  return (
    state.keys.has('ShiftLeft') || state.keys.has('ShiftRight') || state.sprintTouch || padSprint
  );
}

export function consumeJump() {
  const v = state.jumpPressed;
  state.jumpPressed = false;
  return v;
}

export function consumeAttack() {
  const v = state.attackPressed;
  state.attackPressed = false;
  return v;
}

export function consumeLook() {
  const dx = state.look.dx;
  state.look.dx = 0;
  return dx;
}

export function consumeInteract() {
  const v = state.interactPressed;
  state.interactPressed = false;
  return v;
}

export function consumePause() {
  const v = state.pausePressed;
  state.pausePressed = false;
  return v;
}

export const inputActions = {
  setJoystick: (x: number, y: number) => {
    state.joy.x = x;
    state.joy.y = y;
  },
  addLook: (dx: number) => {
    state.look.dx += dx;
  },
  interact: () => {
    state.interactPressed = true;
  },
  pause: () => {
    state.pausePressed = true;
  },
  jump: () => {
    state.jumpPressed = true;
  },
  attack: () => {
    state.attackPressed = true;
  },
  setSprint: (held: boolean) => {
    state.sprintTouch = held;
  },
};

/** Attach keyboard listeners; returns cleanup. */
export function attachKeyboard() {
  const down = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (
      [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
      ].includes(e.code)
    ) {
      e.preventDefault();
    }
    const repeat = e.repeat || state.keys.has(e.code);
    state.keys.add(e.code);
    if (e.code === 'KeyE' || e.code === 'Enter') state.interactPressed = true;
    if (e.code === 'Space' && !repeat) state.jumpPressed = true;
    if (e.code === 'KeyF' && !repeat) state.attackPressed = true;
    if (e.code === 'Escape' || e.code === 'KeyP') state.pausePressed = true;
  };
  const up = (e: KeyboardEvent) => state.keys.delete(e.code);
  const blur = () => {
    state.keys.clear();
    state.sprintTouch = false;
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
    state.keys.clear();
    state.joy = { x: 0, y: 0 };
    state.sprintTouch = false;
    state.jumpPressed = false;
    state.attackPressed = false;
  };
}
