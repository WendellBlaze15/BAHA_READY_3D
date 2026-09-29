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
      containerClassName="justify-start"
    >
      <InputOTPGroup className="gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <InputOTPSlot
            key={i}
            index={i}
            className="font-display size-12 rounded-sm border text-2xl font-bold first:rounded-sm last:rounded-sm sm:size-14"
          />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
