import type {ReactNode} from 'react';

/** Legends draw the marks themselves (a box, an underline, a tick), so a key never looks like a checkbox. */
function Mark({children}: {children: ReactNode}) {
  return <svg className="legend-mark" width="26" height="16" viewBox="0 0 26 16" aria-hidden="true" focusable="false">{children}</svg>;
}

export function TreeLegend() {
  return <ul className="tree-legend" aria-label="Legend">
    <li><Mark><rect className="lg-run" x="2" y="2" width="22" height="12" rx="3" /></Mark>Running</li>
    <li><Mark><path className="lg-ink" d="M4 12.5h18" /><path className="lg-faint" d="M5 6.5h16" /></Mark>Waiting</li>
    <li><Mark><path className="lg-tick" d="M6 8.5l4 4.5 9-10" /></Mark>Returned</li>
    <li><Mark><path className="lg-ret" d="M13 14V3 M8.5 7.5L13 3l4.5 4.5" /></Mark>Value coming back</li>
    <li><span className="lg-hand" aria-hidden="true">×2</span>Same arguments again</li>
  </ul>;
}

export function MemoryLegend() {
  return <ul className="tree-legend" aria-label="Legend">
    <li><Mark><rect className="lg-ink" x="2" y="2" width="22" height="12" rx="3" /></Mark>Heap object</li>
    <li><Mark><rect className="lg-new" x="2" y="2" width="22" height="12" rx="3" /></Mark>New here</li>
    <li><Mark><path className="lg-ptr" d="M3 8h17 M16 4.5L20.5 8 16 11.5" /></Mark>Pointer</li>
    <li><Mark><path className="lg-ink" d="M8 3.5l10 9 M18 3.5l-10 9" /></Mark>Dangling</li>
    <li><Mark><rect className="lg-dashed" x="2" y="2" width="22" height="12" rx="3" /></Mark>Unproven</li>
  </ul>;
}
