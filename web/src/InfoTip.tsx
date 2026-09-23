import type {ReactNode} from 'react';

/** Explanations on demand: a small ⓘ that opens a note, instead of a paragraph
 *  that takes room in every panel after its first reading. */
export function InfoTip({children, label = 'About this view'}: {children: ReactNode; label?: string}) {
  return <details className="info-tip">
    <summary aria-label={label} title={label}>ⓘ</summary>
    <div className="info-body" role="note">{children}</div>
  </details>;
}
