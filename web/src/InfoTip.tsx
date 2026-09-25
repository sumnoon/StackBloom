import type {ReactNode} from 'react';
import {Icon} from './Icon';

/** Explanations on demand: a small info mark that opens a sticky note, instead of a paragraph
 *  that takes room in every panel after its first reading. */
export function InfoTip({children, label = 'About this view'}: {children: ReactNode; label?: string}) {
  return <details className="info-tip">
    <summary aria-label={label} title={label}><Icon name="info" size={20} /></summary>
    <div className="info-body" role="note">{children}</div>
  </details>;
}
