/** Small diagrams describe the examples without requiring external assets. */
export function ExampleGlyph({kind}: {kind: 'chain' | 'fork' | 'list' | 'tree' | 'grid' | 'memo'}) {
  // A memo: a small key → value table beside one call.
  if (kind === 'memo') return <svg viewBox="0 0 72 56" aria-hidden="true" className="example-glyph memo">
    <circle cx="12" cy="28" r="6" />
    <line x1="18" y1="28" x2="28" y2="28" />
    {[0, 1, 2].map(r => <g key={r}><rect x="30" y={8 + r * 15} width="16" height="12" rx="2" />
      <rect x="50" y={8 + r * 15} width="16" height="12" rx="2" className={r === 2 ? 'filled' : undefined} /></g>)}
  </svg>;
  // A DP table: a small grid whose last cell is being filled.
  if (kind === 'grid') return <svg viewBox="0 0 72 56" aria-hidden="true" className="example-glyph grid">
    {[0, 1, 2].map(r => [0, 1, 2, 3].map(c => <rect key={`${r}${c}`} x={6 + c * 16} y={6 + r * 15} width="14" height="13" rx="2"
      className={r === 2 && c === 3 ? 'filled' : undefined} />))}
  </svg>;
  const points = kind === 'chain' ? [[18, 10], [36, 26], [54, 42]]
    : kind === 'list' ? [[12, 26], [36, 26], [60, 26]]
    : [[36, 8], [18, 27], [54, 27], [8, 46], [28, 46], [62, 46]];
  const edges = kind === 'chain' || kind === 'list' ? [[0, 1], [1, 2]] : [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5]];
  return <svg viewBox="0 0 72 56" aria-hidden="true" className={`example-glyph ${kind}`}>
    {edges.map(([a, b], i) => <line key={i} x1={points[a][0]} y1={points[a][1]} x2={points[b][0]} y2={points[b][1]} />)}
    {points.map(([x, y], i) => kind === 'list'
      ? <rect key={i} x={x - 7} y={y - 7} width="14" height="14" rx="4" />
      : <circle key={i} cx={x} cy={y} r={i === 0 ? 6 : 5} />)}
  </svg>;
}
