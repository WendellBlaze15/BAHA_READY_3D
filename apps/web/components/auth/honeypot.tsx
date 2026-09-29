import { forwardRef } from 'react';

/**
 * Invisible honeypot (no CAPTCHA, Section 12). Hidden from people and assistive tech;
 * naive bots fill it in, and the server silently discards those requests.
 */
export const Honeypot = forwardRef<HTMLInputElement>(function Honeypot(_, ref) {
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}
    >
      <label>
        Website
        <input
          ref={ref}
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </label>
    </div>
  );
});
