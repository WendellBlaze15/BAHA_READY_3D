'use client';

import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

/** Six boxes, auto-advance, paste support; calls onComplete on the 6th digit. */
export function OtpCodeField({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  describedBy,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  label: string;
}) {
  return (
    <InputOTP
      id={id}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      containerClassName="w-full"
    >
      {/* Fluid grid: six equal boxes that fit from 320px phones up. */}
      <InputOTPGroup className="grid w-full grid-cols-6 gap-1.5 sm:gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <InputOTPSlot
            key={i}
            index={i}
            className="font-display bg-background h-13 w-full rounded-lg border text-2xl font-bold first:rounded-lg first:border-l last:rounded-lg sm:h-14"
          />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
