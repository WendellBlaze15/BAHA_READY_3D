/**
 * Static poster of the blocky lakeside town. Rendered on the server for instant LCP;
 * the live 3D diorama replaces it after idle on capable devices (Phase 5).
 */
export function DioramaPoster() {
  return (
    <svg
      viewBox="0 0 480 320"
      role="img"
      aria-label="Blocky lakeside town with rising floodwater"
      className="h-auto w-full"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5c7285" />
          <stop offset="1" stopColor="#a9b8c3" />
        </linearGradient>
        <pattern
          id="rain"
          width="14"
          height="22"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(12)"
        >
          <rect x="6" y="0" width="1.4" height="9" fill="#ffffff" opacity="0.45" />
        </pattern>
      </defs>
      <rect width="480" height="320" rx="20" fill="url(#sky)" />
      {/* Clouds */}
      <rect x="40" y="30" width="120" height="26" rx="6" fill="#3d4f60" />
      <rect x="70" y="16" width="70" height="24" rx="6" fill="#3d4f60" />
      <rect x="290" y="40" width="150" height="28" rx="6" fill="#34465a" />
      {/* Church */}
      <rect x="330" y="120" width="60" height="110" fill="#e8dcc8" />
      <rect x="345" y="92" width="30" height="40" fill="#e8dcc8" />
      <rect x="340" y="84" width="40" height="12" fill="#b04a34" />
      <rect x="352" y="170" width="16" height="60" fill="#6b4a33" />
      {/* Bahay na bato */}
      <rect x="60" y="150" width="120" height="44" fill="#c7b199" />
      <rect x="52" y="112" width="136" height="42" fill="#8a5a3c" />
      <rect x="44" y="100" width="152" height="16" fill="#b04a34" />
      <rect x="72" y="122" width="24" height="20" fill="#f2e6b8" />
      <rect x="112" y="122" width="24" height="20" fill="#f2e6b8" />
      <rect x="152" y="122" width="24" height="20" fill="#f2e6b8" />
      {/* Sari-sari store */}
      <rect x="210" y="160" width="80" height="60" fill="#2e8b57" />
      <rect x="204" y="148" width="92" height="16" fill="#f2a516" />
      <rect x="222" y="178" width="56" height="22" fill="#1e2a38" opacity="0.6" />
      {/* Blocky character on roof edge */}
      <rect x="236" y="120" width="14" height="14" rx="2" fill="#f1c27d" />
      <rect x="233" y="134" width="20" height="16" rx="2" fill="#d2402f" />
      <rect
        x="226"
        y="124"
        width="7"
        height="20"
        rx="2"
        fill="#f1c27d"
        transform="rotate(-30 229 124)"
      />
      {/* Floodwater */}
      <rect x="0" y="210" width="480" height="110" fill="#8a6b4a" opacity="0.92" />
      <rect x="0" y="206" width="480" height="8" fill="#a88763" />
      <rect x="40" y="240" width="60" height="4" rx="2" fill="#c9ad8a" opacity="0.7" />
      <rect x="220" y="262" width="90" height="4" rx="2" fill="#c9ad8a" opacity="0.7" />
      <rect x="360" y="232" width="70" height="4" rx="2" fill="#c9ad8a" opacity="0.7" />
      {/* Evacuation sign */}
      <rect x="420" y="160" width="6" height="70" fill="#1e2a38" />
      <rect x="400" y="140" width="46" height="28" rx="3" fill="#2e8b57" />
      <path d="M410 154h20m-6-6 6 6-6 6" stroke="#fff" strokeWidth="3" fill="none" />
      <rect width="480" height="320" rx="20" fill="url(#rain)" />
    </svg>
  );
}
