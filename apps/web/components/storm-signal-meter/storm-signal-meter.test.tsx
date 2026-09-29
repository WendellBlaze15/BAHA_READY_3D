import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StormSignalMeter } from './storm-signal-meter';

describe('StormSignalMeter', () => {
  it('exposes an accessible meter with clamped value', () => {
    render(<StormSignalMeter value={7} label="Progress" valueText="Signal No. 5" />);
    const meter = screen.getByRole('meter', { name: 'Progress' });
    expect(meter).toHaveAttribute('aria-valuenow', '5');
    expect(meter).toHaveAttribute('aria-valuetext', 'Signal No. 5');
  });

  it('partially fills the current segment using transform only', () => {
    const { container } = render(<StormSignalMeter value={2.5} label="Load" />);
    const fills = container.querySelectorAll<HTMLDivElement>('.origin-left');
    expect(fills).toHaveLength(5);
    expect(fills[0]!.style.transform).toBe('scaleX(1)');
    expect(fills[2]!.style.transform).toBe('scaleX(0.5)');
    expect(fills[4]!.style.transform).toBe('scaleX(0)');
  });

  it('labels segments with numbers so state is not color-only', () => {
    render(<StormSignalMeter value={1} label="x" />);
    for (const n of ['1', '2', '3', '4', '5']) expect(screen.getByText(n)).toBeInTheDocument();
  });
});
