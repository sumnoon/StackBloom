import {applyPalette, GIFEncoder, quantize} from 'gifenc';
import type {Trace} from './trace';

/** Turning the board's SVG drawings into pictures, videos and GIFs, in the browser. */

// Styles that come from the stylesheet; an SVG drawn as an image cannot see the page's CSS.
const PROPERTIES = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'text-underline-offset', 'visibility'];
const FAMILIES = ['Bricolage Grotesque Variable', 'JetBrains Mono', 'Patrick Hand'];

let fontCss: Promise<string> | null = null;

/** The latin subsets of the board's fonts as data URIs, so the pictures keep the chalk hand and the mono. */
function embeddedFonts() {
  fontCss ??= (async () => {
    const rules: {rule: CSSFontFaceRule; base: string}[] = [];
    for (const sheet of [...document.styleSheets]) {
      let list: CSSRuleList;
      try {list = sheet.cssRules;} catch {continue;}
      for (const rule of [...list]) if (rule instanceof CSSFontFaceRule) rules.push({rule, base: sheet.href ?? location.href});
    }
    const faces = await Promise.all(rules.filter(({rule}) => {
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const range = rule.style.getPropertyValue('unicode-range');
      // The latin subset; browsers may normalise its range to U+0-FF.
      return FAMILIES.includes(family) && (!range || /U\+0+-0*FF(?![0-9A-F])/i.test(range));
    }).map(async ({rule, base}) => {
      const url = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+\.woff2)["']?\)/)?.[1];
      if (!url) return '';
      const blob = await (await fetch(new URL(url, base))).blob();
      const data = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      return `@font-face{font-family:${rule.style.getPropertyValue('font-family')};font-style:${rule.style.getPropertyValue('font-style') || 'normal'};` +
        `font-weight:${rule.style.getPropertyValue('font-weight') || '400'};src:url(${data}) format('woff2');}`;
    }));
    return faces.join('');
  })();
  return fontCss;
}

export type Drawing = {svg: string; width: number; height: number};

/** A self-contained copy of an on-screen SVG: computed styles inlined, fonts embedded, drawn at viewBox size. */
export async function captureSvg(svg: SVGSVGElement): Promise<Drawing> {
  const [x = 0, y = 0, width = svg.clientWidth, height = svg.clientHeight] =
    (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const source = [svg, ...svg.querySelectorAll('*')];
  const target = [copy, ...copy.querySelectorAll('*')];
  source.forEach((element, i) => {
    const style = getComputedStyle(element);
    const into = target[i] as SVGElement;
    into.setAttribute('style', PROPERTIES.map(name => `${name}:${style.getPropertyValue(name)}`).join(';'));
    into.removeAttribute('class');
  });
  copy.querySelectorAll('title').forEach(title => title.remove());
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = await embeddedFonts();
  copy.insertBefore(style, copy.firstChild);
  return {svg: new XMLSerializer().serializeToString(copy), width, height};
}

export function loadImage(drawing: Drawing) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The drawing could not be rendered.'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing.svg)}`;
  });
}

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function download(blob: Blob, name: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

const TRACE_SLOT = '<script type="application/json" id="stackbloom-trace">null</script>';

/** One HTML file holding the viewer and this trace. It opens from disk and never runs code. */
export async function shareHtml(trace: Trace, name: string) {
  const response = await fetch('stackbloom-viewer.html', {cache: 'no-store'});
  const template = response.ok ? await response.text() : '';
  // The dev server answers unknown paths with the app itself, so check for the slot, not the status.
  if (!template.includes(TRACE_SLOT))
    throw new Error('Sharing as HTML needs the built viewer. Run npm run build, then open StackBloom with python stackbloom.py.');
  // JSON cannot end the script element early once every "<" is escaped.
  const json = JSON.stringify(trace).replace(/</g, '\\u003c');
  const title = `${trace.source.path} · StackBloom`.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'));
  const html = template
    .replace(TRACE_SLOT, () => `<script type="application/json" id="stackbloom-trace">${json}</script>`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`);
  download(new Blob([html], {type: 'text/html'}), name);
}

/** The current graph as a PNG on the board's ground, at twice its drawn size. */
export async function exportPicture(svg: SVGSVGElement, name: string) {
  await document.fonts.ready;
  const drawing = await captureSvg(svg);
  const image = await loadImage(drawing);
  const scale = 2, pad = 32;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((drawing.width + pad * 2) * scale);
  canvas.height = Math.round((drawing.height + pad * 2) * scale);
  const context = canvas.getContext('2d')!;
  context.fillStyle = token('--board');
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, pad * scale, pad * scale, drawing.width * scale, drawing.height * scale);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The picture could not be made.');
  download(blob, name);
}

export type Frame = {drawing: Drawing; note: string; stop: string};

/** Lays every frame on one canvas size, so the tree grows in place instead of zooming frame to frame. */
function stage(frames: Frame[], maxWidth: number) {
  const widest = Math.max(...frames.map(frame => frame.drawing.width));
  const tallest = Math.max(...frames.map(frame => frame.drawing.height));
  const pad = 40, header = 64, footer = 84;
  const scale = Math.min(1.25, (maxWidth - pad * 2) / widest, 620 / tallest);
  const even = (n: number) => Math.ceil(n / 2) * 2;
  return {scale, pad, header, footer, width: even(maxWidth), height: even(header + tallest * scale + footer + pad)};
}

function paint(context: CanvasRenderingContext2D, layout: ReturnType<typeof stage>, frame: Frame, image: HTMLImageElement, title: string) {
  const {scale, pad, header, width, height} = layout;
  context.fillStyle = token('--board');
  context.fillRect(0, 0, width, height);
  context.fillStyle = token('--ink');
  context.font = `800 26px 'Bricolage Grotesque Variable', sans-serif`;
  context.textBaseline = 'alphabetic';
  context.fillText('StackBloom', pad, 44);
  const brandWidth = context.measureText('StackBloom').width;
  context.fillStyle = token('--ink-soft');
  context.font = `14px 'JetBrains Mono', monospace`;
  context.fillText(title, pad + brandWidth + 14, 44);
  const w = frame.drawing.width * scale, h = frame.drawing.height * scale;
  context.drawImage(image, (width - w) / 2, header, w, h);
  // The step's sticky note along the bottom, and where in the run this is.
  if (frame.note) {
    context.font = `24px 'Patrick Hand', cursive`;
    const textWidth = context.measureText(frame.note).width;
    const x = pad, y = height - 70;
    context.fillStyle = token('--note');
    context.fillRect(x, y, textWidth + 32, 44);
    context.fillStyle = token('--note-ink');
    context.fillText(frame.note, x + 16, y + 30);
  }
  context.fillStyle = token('--ink-soft');
  context.font = `16px 'JetBrains Mono', monospace`;
  const stopWidth = context.measureText(frame.stop).width;
  context.fillText(frame.stop, width - pad - stopWidth, height - 40);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function videoType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** Records the frames as a video in real time from a canvas stream (MP4 where the browser can, else WebM). */
export async function encodeVideo(frames: Frame[], title: string, frameMs: number) {
  const type = videoType();
  if (!type) throw new Error('This browser cannot record video. Try the GIF instead.');
  const images = await Promise.all(frames.map(frame => loadImage(frame.drawing)));
  const layout = stage(frames, 1280);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width; canvas.height = layout.height;
  const context = canvas.getContext('2d')!;
  paint(context, layout, frames[0], images[0], title);
  const recorder = new MediaRecorder(canvas.captureStream(30), {mimeType: type, videoBitsPerSecond: 5_000_000});
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
  const done = new Promise(resolve => {recorder.onstop = resolve;});
  recorder.start();
  for (let i = 0; i < frames.length; i++) {
    paint(context, layout, frames[i], images[i], title);
    await sleep(i === frames.length - 1 ? 1800 : frameMs);
  }
  recorder.stop();
  await done;
  return {blob: new Blob(chunks, {type: type.split(';')[0]}), extension: type.startsWith('video/mp4') ? 'mp4' : 'webm'};
}

/** Encodes the frames as a looping GIF, a palette per frame (the board has few colours). */
export async function encodeGif(frames: Frame[], title: string, frameMs: number) {
  const images = await Promise.all(frames.map(frame => loadImage(frame.drawing)));
  const layout = stage(frames, 900);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width; canvas.height = layout.height;
  const context = canvas.getContext('2d', {willReadFrequently: true})!;
  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    paint(context, layout, frames[i], images[i], title);
    const {data} = context.getImageData(0, 0, layout.width, layout.height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), layout.width, layout.height,
      {palette, delay: i === frames.length - 1 ? 1800 : frameMs});
    if (i % 8 === 7) await sleep(0);
  }
  gif.finish();
  // Copy into a plain ArrayBuffer-backed array: Blob parts may not be SharedArrayBuffer views.
  return new Blob([new Uint8Array(gif.bytes())], {type: 'image/gif'});
}
