import {useRef} from 'react';
import {Icon} from './Icon';
import {videoType} from './exporter';
import './export.css';

export type ExportKind = 'picture' | 'video' | 'gif';

/** Export for sharing: the current graph as a picture, or the recursion tree growing as a video or GIF. */
export function ExportMenu({canPicture, canRecord, busy, onExport}: {
  canPicture: boolean; canRecord: boolean; busy: boolean; onExport: (kind: ExportKind) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const video = videoType();
  const pick = (kind: ExportKind) => {menu.current?.removeAttribute('open'); onExport(kind);};
  return <details className="export-menu" ref={menu}>
    <summary title="Export a picture, video or GIF" aria-label="Export"><Icon name="export" /><span className="btn-label">Export</span></summary>
    <div className="export-list">
      <button onClick={() => pick('picture')} disabled={!canPicture || busy}>
        Picture of this graph <small>PNG</small></button>
      <button onClick={() => pick('video')} disabled={!canRecord || busy || !video}>
        The tree growing <small>{video?.startsWith('video/mp4') ? 'MP4 video' : video ? 'WebM video' : 'video unsupported here'}</small></button>
      <button onClick={() => pick('gif')} disabled={!canRecord || busy}>
        The tree growing <small>GIF</small></button>
    </div>
  </details>;
}

export function ExportProgress({done, total, phase, onCancel}: {done: number; total: number; phase: string; onCancel: () => void}) {
  return <div className="export-progress" role="status">
    <span>{phase} {total ? `${done} of ${total}` : ''}</span>
    <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
  </div>;
}
