import {useLayoutEffect, useMemo, useRef, useState} from 'react';

/** Zoom shared by the graph panels: fit-to-window by default, fixed steps otherwise. */
export type ZoomMode = 'fit' | number;

const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2];
const MIN_FIT = 0.1, PADDING = 18;

export function useZoom(width: number, height: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ZoomMode>('fit');
  const [box, setBox] = useState({width: 0, height: 0});

  // Measure after every render: a tab that just appeared has its size only then,
  // and ResizeObserver callbacks are not delivered while a page is hidden.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const {clientWidth, clientHeight} = element;
      setBox(current => Math.abs(current.width - clientWidth) < 1 && Math.abs(current.height - clientHeight) < 1
        ? current : {width: clientWidth, height: clientHeight});
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  const fit = useMemo(() => {
    if (!box.width || !box.height || !width || !height) return 1;
    // Never enlarge past 100%: a two-node graph blown up reads worse, not better.
    return Math.max(MIN_FIT, Math.min(1, (box.width - PADDING) / width, (box.height - PADDING) / height));
  }, [box.width, box.height, width, height]);

  return {ref, mode, setMode, fit, zoom: mode === 'fit' ? fit : mode};
}

export function ZoomControl({label, mode, setMode, fit}:
    {label: string; mode: ZoomMode; setMode: (mode: ZoomMode) => void; fit: number}) {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return <label className="zoom-control">Zoom
    <select aria-label={label} value={mode === 'fit' ? 'fit' : String(mode)}
      onChange={e => setMode(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
      <option value="fit">Fit ({percent(fit)})</option>
      {STEPS.map(step => <option key={step} value={String(step)}>{percent(step)}</option>)}
    </select>
  </label>;
}
