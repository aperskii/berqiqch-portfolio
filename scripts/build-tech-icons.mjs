/**
 * Regenerate the brand-mark symbols in the inline sprite.
 *
 *   npm run icons
 *
 * Icons come from the simple-icons package (CC0-1.0) and are written straight
 * into the sprite in src/index.html, between the tech-icons markers. Nothing is
 * fetched at runtime and no icon font is shipped — the same reason the rest of
 * the sprite is inline rather than pulled from a CDN.
 *
 * Each icon is reduced to one path on a 24x24 viewBox and painted with
 * currentColor: the site has a single accent, and twenty-odd brand palettes
 * would fight it.
 *
 * Only tags that name a real tool, language or platform get a mark. Concepts
 * like "REST APIs" or "SOLID Principles" have no logo, and inventing one would
 * be as dishonest as the skill percentages this design deliberately dropped.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as icons from 'simple-icons';

const ROOT = path.join(import.meta.dirname, '..');
const HTML = path.join(ROOT, 'src', 'index.html');

const START = '<!-- tech-icons:start -->';
const END = '<!-- tech-icons:end -->';

/** sprite id suffix -> simple-icons export. Order is the order in the sprite. */
const WANTED = [
  // Backend
  ['go', 'siGo'],
  ['php', 'siPhp'],
  ['laravel', 'siLaravel'],
  ['symfony', 'siSymfony'],
  ['ruby', 'siRuby'],
  ['node', 'siNodedotjs'],
  // Frontend
  ['javascript', 'siJavascript'],
  ['react', 'siReact'],
  ['nextjs', 'siNextdotjs'],
  ['html', 'siHtml5'],
  ['tailwind', 'siTailwindcss'],
  ['bootstrap', 'siBootstrap'],
  // Database
  ['postgresql', 'siPostgresql'],
  ['mysql', 'siMysql'],
  // Cloud & DevOps
  ['docker', 'siDocker'],
  ['terraform', 'siTerraform'],
  ['kubernetes', 'siKubernetes'],
  ['githubactions', 'siGithubactions'],
  ['git', 'siGit'],
  // AI & Tools
  ['claude', 'siClaude'],
  ['wordpress', 'siWordpress'],
  ['cursor', 'siCursor']
];

/* Deliberately absent: AWS, Azure and OpenAI. simple-icons removed those brands
 * at the trademark holders' request, and redrawing a logo by hand to fill the
 * gap would be exactly the fabrication this list exists to avoid. Those tags
 * stay text-only until an officially licensed mark is dropped in. */

/* One path, no <title>: a title inside a referenced symbol shows up as a native
 * hover tooltip on every pill, which is not what these are for. The tags are
 * already labelled by their own text. */
function symbol(id, icon) {
  return `    <symbol id="i-tech-${id}" viewBox="0 0 24 24" fill="currentColor">` +
    `<path d="${icon.path}" /></symbol>`;
}

async function main() {
  const missing = WANTED.filter(([, key]) => !icons[key]);
  if (missing.length) {
    throw new Error(
      'not in simple-icons: ' + missing.map(([id, key]) => `${id} (${key})`).join(', ')
    );
  }

  const symbols = WANTED.map(([id, key]) => symbol(id, icons[key])).join('\n');
  const html = await readFile(HTML, 'utf8');

  const from = html.indexOf(START);
  const to = html.indexOf(END);
  if (from === -1 || to === -1) throw new Error(`markers ${START} / ${END} not found in index.html`);

  const out = html.slice(0, from + START.length) + '\n' + symbols + '\n' + html.slice(to);
  await writeFile(HTML, out, 'utf8');

  const bytes = Buffer.byteLength(symbols, 'utf8');
  console.log(`[icons] ${WANTED.length} symbols written, ${(bytes / 1024).toFixed(1)} KB of sprite`);
  for (const [id, key] of WANTED) console.log(`  i-tech-${id.padEnd(14)} ${icons[key].title}`);
}

main().catch((err) => {
  console.error('[icons] failed:', err.message);
  process.exit(1);
});
