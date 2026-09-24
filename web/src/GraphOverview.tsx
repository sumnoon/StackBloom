import {useEffect, useState, type RefObject} from 'react';

type Box = {x: number; y: number; width: number; height: number};
/** A small overview tracks the real scroll viewport, not a separate graph camera. */
export function GraphOverview({canvas, width, height, zoom, nodes}: {
  canvas: RefObject<HTMLDivElement | null>; width: number; height: number; zoom: number; nodes: Box[];
}) {
  const [viewport, setViewport] = useState<Box>({x:0, y:0, width:0, height:0});
  // It sits over the graph's corner, so it folds away when that corner is what you want to read.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => setViewport({x:element.scrollLeft / zoom, y:element.scrollTop / zoom,
      width:element.clientWidth / zoom, height:element.clientHeight / zoom});
    measure(); element.addEventListener('scroll', measure, {passive:true});
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => {observer.disconnect(); element.removeEventListener('scroll', measure);};
  }, [canvas, width, height, zoom]);
  if (!nodes.length || (viewport.width >= width && viewport.height >= height)) return null;
  if (!open) return <button className="ghost graph-overview-toggle" onClick={() => setOpen(true)} aria-label="Show graph overview">Overview</button>;
  return <div className="graph-overview" tabIndex={0} role="region" aria-label="Graph overview. Click to pan, or use arrow keys."
    onKeyDown={event => {
      const element = canvas.current;
      if (!element || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Home') element.scrollTo({left:0, top:0});
      else element.scrollBy({left:event.key === 'ArrowLeft' ? -100 : event.key === 'ArrowRight' ? 100 : 0,
        top:event.key === 'ArrowUp' ? -100 : event.key === 'ArrowDown' ? 100 : 0});
    }}>
    <div className="graph-overview-head"><span>Overview</span>
      <button className="ghost" onClick={() => setOpen(false)} aria-label="Hide graph overview" title="Hide overview">×</button></div>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        canvas.current?.scrollTo({left:(event.clientX - bounds.left) / bounds.width * width * zoom - viewport.width * zoom / 2,
          top:(event.clientY - bounds.top) / bounds.height * height * zoom - viewport.height * zoom / 2});
      }}>
      {nodes.map((node, index) => <rect key={index} {...node} className="overview-node" />)}
      <rect x={viewport.x} y={viewport.y} width={Math.min(width, viewport.width)} height={Math.min(height, viewport.height)} className="overview-viewport" />
    </svg>
  </div>;
}
