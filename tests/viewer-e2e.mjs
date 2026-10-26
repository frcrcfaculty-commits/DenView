// End-to-end viewer test: renders the real WebView HTML in headless Edge/Chrome
// with ALL network blocked, loads each fixture DICOM, and asserts it decodes and
// paints non-blank pixels. Run from repo root:  node tests/viewer-e2e.mjs
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fe = path.join(root, 'frontend');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-e2e-'));
const bundle = path.join(tmp, 'viewer.cjs');
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--yes', 'esbuild', 'src/utils/dicomViewerHtml.ts', '--bundle', '--format=cjs', '--platform=node', `--outfile=${bundle}`, '--log-level=warning'],
  { cwd: fe, stdio: 'inherit', shell: process.platform === 'win32' });
const { getDicomViewerHtml } = createRequire(import.meta.url)(bundle);

// expected transfer syntax per fixture (pydicom test files, MIT)
const cases = {
  'MR_small.dcm': 'Explicit VR LE (uncompressed)',
  'MR_small_jp2klossless.dcm': 'JPEG 2000 lossless (.90)',
  'JPEG2000.dcm': 'JPEG 2000 lossy (.91)',
  'MR_small_RLE.dcm': 'RLE lossless (.5)',
  'SC_rgb_jpeg_gdcm.dcm': 'JPEG lossless P14 SV1 (.70)',
};
const fx = Object.fromEntries(Object.keys(cases).map(f => [f, fs.readFileSync(path.join(root, 'tests', 'fixtures', f)).toString('base64')]));

const pre = `<script>window.__log=[];window.__errs=[];window.onerror=function(m){__errs.push(String(m))};
window.postMessage=function(m){try{__log.push(JSON.parse(m))}catch(e){}};</script>`;
const post = `<script>var FX=${JSON.stringify(fx)};var res={};
function stats(){var c=document.getElementById('canvas');var d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
 var lit=0;for(var i=0;i<d.length;i+=4){if(d[i]+d[i+1]+d[i+2]>60)lit++}return lit}
var t=setInterval(function(){if(!__log.some(function(m){return m.type==='ready'}))return;clearInterval(t);
 var names=Object.keys(FX),i=0;
 (function next(){if(i>=names.length){document.body.setAttribute('data-r',JSON.stringify({res:res,errs:__errs}));return}
  var n=names[i++];var start=__log.length;handleCommand({type:'loadDicom',base64:FX[n]});
  setTimeout(function(){var m=__log.slice(start);var err=m.filter(function(x){return x.type==='error'})[0];
   res[n]={ok:!err&&m.some(function(x){return x.type==='metadata'}),error:err?err.data.message:null,litPixels:stats()};next()},500)})()},50);</script>`;
const html = getDicomViewerHtml().replace('<head>', '<head>' + pre).replace('</body>', post + '</body>');
const page = path.join(tmp, 'e2e.html');
fs.writeFileSync(page, html);

const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].concat(process.env.CHROME_PATH ? [process.env.CHROME_PATH] : []);
const browser = browsers.find(b => fs.existsSync(b));
if (!browser) { console.error('No Chromium browser found; set CHROME_PATH'); process.exit(2); }

const dom = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=800,800',
  '--host-resolver-rules=MAP * ~NOTFOUND', '--virtual-time-budget=20000', '--dump-dom',
  'file:///' + page.replace(/\\/g, '/')], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const m = dom.match(/data-r="([^"]*)"/);
if (!m) { console.error('viewer never finished; no result'); process.exit(1); }
const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
let failed = out.errs.length;
for (const [f, label] of Object.entries(cases)) {
  const r = out.res[f];
  const pass = r && r.ok && r.litPixels > 500;
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(30)} ${f}  lit=${r?.litPixels}${r?.error ? '  err=' + r.error : ''}`);
}
if (out.errs.length) console.log('page errors:', out.errs);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
