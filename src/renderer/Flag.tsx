const FLAGS: Record<string, string[]> = {
  nl: ['#AE1C28', '#FFFFFF', '#21468B'],
  de: ['#000000', '#DD0000', '#FFCE00'],
  gb: ['#012169'],
  us: ['#B22234'],
  ru: ['#FFFFFF', '#0039A6', '#D52B1E'],
  se: ['#006AA7'],
  pl: ['#FFFFFF', '#DC143C'],
  fi: ['#FFFFFF'],
  jp: ['#FFFFFF'],
  fr: ['#0055A4', '#FFFFFF', '#EF4135'],
  eu: ['#003399'],
  tr: ['#E30A17'],
};

export function Flag({ code }: { code?: string }) {
  const iso = (code || 'un').toLowerCase();
  const stripes = FLAGS[iso];
  if (!stripes) {
    return <span className="happ-flag-fallback">{(code || '·').slice(0, 2).toUpperCase()}</span>;
  }
  if (iso === 'jp') {
    return <span className="happ-flag-svg" style={{ background: '#fff' }}><i style={{ width: 10, height: 10, borderRadius: '50%', background: '#bc002d', display: 'block' }} /></span>;
  }
  if (iso === 'gb' || iso === 'us' || iso === 'eu' || iso === 'se' || iso === 'fi' || iso === 'tr') {
    return <span className="happ-flag-svg" style={{ background: stripes[0] }} />;
  }
  return <span className="happ-flag-svg">{stripes.map((color) => <i key={color} style={{ flex: 1, background: color }} />)}</span>;
}
