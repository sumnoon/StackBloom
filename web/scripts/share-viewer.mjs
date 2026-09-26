// Folds the share build (dist-share/) into one HTML file, dist/stackbloom-viewer.html.
// The viewer fetches that file when exporting "Share as HTML" and fills in the trace, so the
// result opens from disk anywhere: no server, no network, and nothing in it compiles or runs code.
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const share = join(web, 'dist-share');
const read = path => readFileSync(join(share, path.replace(/^\//, '')));
let html = read('index.html').toString('utf8');

const FONT_TYPES = {'.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml'};
// woff2 works in every browser that can run the viewer, so the .woff fallbacks are dropped.
function inlineCss(css) {
  css = css.replace(/,\s*url\([^)]*\.woff\)\s*format\(["']?woff["']?\)/g, '');
  return css.replace(/url\(([^)]+)\)/g, (whole, raw) => {
    const path = raw.replace(/^["']|["']$/g, '');
    const type = FONT_TYPES[path.slice(path.lastIndexOf('.'))];
    if (!type || path.startsWith('data:')) return whole;
    return `url(data:${type};base64,${read(join('assets', path.split('/').pop())).toString('base64')})`;
  });
}

let scripts = 0, styles = 0;
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => {
  styles++;
  return `<style>${inlineCss(read(href).toString('utf8'))}</style>`;
});
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  scripts++;
  // A literal "</script" inside the code would end the element early.
  return `<script type="module">${read(src).toString('utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
});
if (scripts !== 1 || styles !== 1) throw new Error(`expected one script and one stylesheet, found ${scripts} and ${styles}`);
if (/(src|href)="\/?assets\//.test(html)) throw new Error('the share viewer still points at a separate asset');

// The export replaces this element's text with the trace JSON.
html = html.replace('<div id="root"></div>', '<div id="root"></div><script type="application/json" id="stackbloom-trace">null</script>');
writeFileSync(join(web, 'dist', 'stackbloom-viewer.html'), html);
rmSync(share, {recursive: true, force: true});
console.log(`dist/stackbloom-viewer.html: ${Math.round(html.length / 1024)} KB`);
