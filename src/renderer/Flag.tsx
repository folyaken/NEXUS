import type { ReactNode } from 'react';

function Svg({ children, view = '28 20' }: { children: ReactNode; view?: string }) {
  return (
    <svg className="happ-flag-svg" viewBox={`0 0 ${view}`} preserveAspectRatio="none" aria-hidden>
      {children}
    </svg>
  );
}

export function Flag({ code }: { code?: string }) {
  const iso = (code || 'un').toLowerCase();
  if (iso === 'nl') {
    return <Svg><rect width="28" height="6.7" fill="#AE1C28" /><rect y="6.7" width="28" height="6.6" fill="#fff" /><rect y="13.3" width="28" height="6.7" fill="#21468B" /></Svg>;
  }
  if (iso === 'de') {
    return <Svg><rect width="28" height="6.7" fill="#000" /><rect y="6.7" width="28" height="6.6" fill="#DD0000" /><rect y="13.3" width="28" height="6.7" fill="#FFCE00" /></Svg>;
  }
  if (iso === 'ru') {
    return <Svg><rect width="28" height="6.7" fill="#fff" /><rect y="6.7" width="28" height="6.6" fill="#0039A6" /><rect y="13.3" width="28" height="6.7" fill="#D52B1E" /></Svg>;
  }
  if (iso === 'pl') {
    return <Svg><rect width="28" height="10" fill="#fff" /><rect y="10" width="28" height="10" fill="#DC143C" /></Svg>;
  }
  if (iso === 'fr') {
    return <Svg><rect width="9.4" height="20" fill="#0055A4" /><rect x="9.4" width="9.2" height="20" fill="#fff" /><rect x="18.6" width="9.4" height="20" fill="#EF4135" /></Svg>;
  }
  if (iso === 'it') {
    return <Svg><rect width="9.4" height="20" fill="#009246" /><rect x="9.4" width="9.2" height="20" fill="#fff" /><rect x="18.6" width="9.4" height="20" fill="#CE2B37" /></Svg>;
  }
  if (iso === 'gb' || iso === 'uk') {
    return (
      <Svg>
        <rect width="28" height="20" fill="#012169" />
        <path d="M0 0 L28 20 M28 0 L0 20" stroke="#fff" strokeWidth="4" />
        <path d="M0 0 L28 20 M28 0 L0 20" stroke="#C8102E" strokeWidth="2" />
        <path d="M14 0 V20 M0 10 H28" stroke="#fff" strokeWidth="6.4" />
        <path d="M14 0 V20 M0 10 H28" stroke="#C8102E" strokeWidth="3.4" />
      </Svg>
    );
  }
  if (iso === 'us') {
    return (
      <Svg>
        <rect width="28" height="20" fill="#B22234" />
        {[1, 3, 5, 7, 9, 11, 13].map((row) => <rect key={row} y={row * (20 / 13)} width="28" height={20 / 13} fill="#fff" />)}
        <rect width="12" height="10.8" fill="#3C3B6E" />
      </Svg>
    );
  }
  if (iso === 'se') {
    return <Svg><rect width="28" height="20" fill="#006AA7" /><rect x="8" width="4" height="20" fill="#FECC00" /><rect y="8" width="28" height="4" fill="#FECC00" /></Svg>;
  }
  if (iso === 'fi') {
    return <Svg><rect width="28" height="20" fill="#fff" /><rect x="8" width="4.4" height="20" fill="#003580" /><rect y="8" width="28" height="4.4" fill="#003580" /></Svg>;
  }
  if (iso === 'no') {
    return <Svg><rect width="28" height="20" fill="#BA0C2F" /><rect x="7.2" width="5.2" height="20" fill="#fff" /><rect y="7.4" width="28" height="5.2" fill="#fff" /><rect x="8.2" width="3.2" height="20" fill="#00205B" /><rect y="8.4" width="28" height="3.2" fill="#00205B" /></Svg>;
  }
  if (iso === 'jp') {
    return <Svg><rect width="28" height="20" fill="#fff" /><circle cx="14" cy="10" r="5.2" fill="#BC002D" /></Svg>;
  }
  if (iso === 'eu') {
    return <Svg><rect width="28" height="20" fill="#003399" /><circle cx="14" cy="10" r="3.2" fill="none" stroke="#FFCC00" strokeWidth="1.2" /></Svg>;
  }
  if (iso === 'tr') {
    return <Svg><rect width="28" height="20" fill="#E30A17" /><circle cx="12" cy="10" r="5" fill="#fff" /><circle cx="13.4" cy="10" r="4" fill="#E30A17" /><circle cx="16.4" cy="10" r="1.6" fill="#fff" /></Svg>;
  }
  if (iso === 'ua') {
    return <Svg><rect width="28" height="10" fill="#005BBB" /><rect y="10" width="28" height="10" fill="#FFD500" /></Svg>;
  }
  if (iso === 'kz') {
    return <Svg><rect width="28" height="20" fill="#00AFCA" /><circle cx="14" cy="10" r="4" fill="#FEC50C" /></Svg>;
  }
  return <span className="happ-flag-fallback">{(code || '·').slice(0, 2).toUpperCase()}</span>;
}
