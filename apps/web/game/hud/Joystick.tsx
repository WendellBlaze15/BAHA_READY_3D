'use client';

import { useRef, useState } from 'react';
import { inputActions } from '../systems/input';

const SIZES = { sm: 104, md: 128, lg: 156 } as const;

/** Hand-built virtual joystick (pointer events, multi-touch safe, no dependencies). */
export function Joystick({ size = 'md' }: { size?: keyof typeof SIZES }) {
  const px = SIZES[size];
  const base = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (clientX: number, clientY: number) => {
    const r = base.current!.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = r.width / 2;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    setKnob({ x: dx, y: dy });
    inputActions.setJoystick(dx / max, -dy / max);
  };

  const end = () => {
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    inputActions.setJoystick(0, 0);
  };

  return (
    <div
      ref={base}
      role="application"
      aria-label="Joystick"
      className="relative touch-none rounded-full border-2 border-white/40 bg-black/25 backdrop-blur-sm select-none"
      style={{ width: px, height: px }}
      onPointerDown={(e) => {
        pointer.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (pointer.current === e.pointerId) update(e.clientX, e.clientY);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="absolute top-1/2 left-1/2 rounded-full bg-white/80 shadow-lg"
        style={{
          width: px * 0.42,
          height: px * 0.42,
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
        }}
      />
    </div>
  );
}
