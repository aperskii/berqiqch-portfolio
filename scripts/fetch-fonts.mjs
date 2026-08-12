/**
 * Re-download the self-hosted font subsets.
 *
 *   npm run fonts
 *
 * Fonts are served from our own origin rather than fonts.gstatic.com: embedding
 * Google Fonts transmits visitor IP addresses to a third party, which a German
 * court (LG München I, 20 January 2022, 3 O 17493/20) held to be a GDPR
 * violation. Only the latin and latin-ext subsets are kept.
 *
 * Inter and Space Grotesk are licensed under the SIL Open Font License 1.1.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const FONT_DIR = path.join(ROOT, 'src', 'fonts');
const CSS_OUT = path.join(ROOT, 'src', 'css', 'fonts.css');

const API =
  'https://fonts.googleapis.com/css2' +
  '?family=Inter:wght@400..700' +
  '&family=Space+Grotesk:wght@500..700' +
  '&display=swap';

// A modern UA is required or the API serves legacy truetype instead of woff2.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const KEEP = new Set(['latin', 'latin-ext']);

const slug = (family) => family.toLowerCase().replace(/\s+/g, '-');

async function main() {
  const res = await fetch(API, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Google Fonts API returned ${res.status}`);
  const css = await res.text();

  const blockRe = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
  const wanted = [];

  for (const [, subset, block] of css.matchAll(blockRe)) {
    if (!KEEP.has(subset)) continue;
    const family = block.match(/font-family:\s*['"]([^'"]+)['"]/)?.[1];
    const url = block.match(/url\((https:[^)]+)\)/)?.[1];
    if (family && url) wanted.push({ subset, family, url, block });
  }

  if (!wanted.length) throw new Error('No latin/latin-ext @font-face blocks found.');

  await mkdir(FONT_DIR, { recursive: true });

  let out =
    '/* Self-hosted fonts (GDPR: no third-party requests).\n' +
    '   Inter + Space Grotesk, SIL Open Font License 1.1.\n' +
    '   Regenerate with: npm run fonts */\n\n';

  for (const item of wanted) {
    const filename = `${slug(item.family)}-${item.subset}.woff2`;
    const fontRes = await fetch(item.url);
    if (!fontRes.ok) throw new Error(`Failed to download ${filename}`);
    const buf = Buffer.from(await fontRes.arrayBuffer());
    await writeFile(path.join(FONT_DIR, filename), buf);
    console.log(`[fonts] ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);

    out += item.block.replace(/url\(https:[^)]+\)/, `url(../fonts/${filename})`) + '\n\n';
  }

  await writeFile(CSS_OUT, out, 'utf8');
  console.log(`[fonts] wrote ${path.relative(ROOT, CSS_OUT)}`);
}

main().catch((err) => {
  console.error('[fonts] failed:', err.message);
  process.exit(1);
});
