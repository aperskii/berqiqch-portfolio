/**
 * Build script.
 *
 *   node build.mjs                 site -> dist/, lambda -> build/lambda/
 *   node build.mjs --site-only
 *   node build.mjs --lambda-only
 *   node build.mjs --watch         rebuild the site on change, serve nothing
 *
 * CONTACT_ENDPOINT is substituted into the site bundle. Without it the form
 * renders but tells visitors to email directly, which is the correct
 * behaviour for a build made before the API exists.
 */

import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile, watch } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = import.meta.dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const LAMBDA_SRC = path.join(ROOT, 'lambda', 'contact', 'index.mjs');
const LAMBDA_OUT = path.join(ROOT, 'build', 'lambda');

const args = process.argv.slice(2);
const siteOnly = args.includes('--site-only');
const lambdaOnly = args.includes('--lambda-only');
const isWatch = args.includes('--watch');

const CONTACT_ENDPOINT = process.env.CONTACT_ENDPOINT ?? '';

const STATIC_DIRS = ['images', 'files', 'fonts'];

/* Each language is a real page at its own URL rather than a runtime string
 * swap, so both are crawlable and can carry their own hreflang. They share the
 * stylesheet, the script and the sprite. */
const PAGES = ['index.html', 'de/index.html'];

/* The CSP is script-src 'self' plus a hash for the one inline script (the theme
 * bootstrap in <head>). CloudFront serves that header from Terraform, which is
 * applied separately from this build, so a change here would otherwise only
 * surface as a blocked script in production. Fail the build instead. */
const ALLOWED_INLINE_SCRIPT_HASHES = [
  'sha256-lV+uM4S6WAmmwkLdBTFPUKN/Gx9GqLjBcfSqVnBte2o='
];

function log(msg) {
  console.log(`[build] ${msg}`);
}

/** Conservative HTML trim: drop comments and collapse inter-tag whitespace.
 *  Leaves text nodes, <pre> and <textarea> content untouched. */
function minifyHtml(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .replace(/>\s*\n\s*</g, '><')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Short content hash, used to fingerprint css/js filenames. */
function fingerprint(contents) {
  return createHash('sha256').update(contents).digest('hex').slice(0, 8);
}

/* CSS and JS are written as name.<hash>.ext and the reference in index.html is
 * rewritten to match. Without this the two files keep one URL forever, and the
 * long-lived Cache-Control they are served with pins returning visitors to
 * whichever build they happened to see first — a CloudFront invalidation
 * clears the edge, never the browser. The hash changes the URL, so a new build
 * simply is not the cached one. */
async function buildCss() {
  const files = ['fonts.css', 'style.css'];
  const assets = {};

  for (const file of files) {
    // No bundling: url() references pass through so ../fonts/* stays intact.
    const result = await build({
      entryPoints: [path.join(SRC, 'css', file)],
      minify: true,
      logLevel: 'warning',
      write: false
    });

    const code = result.outputFiles[0].text;
    const name = file.replace(/\.css$/, `.${fingerprint(code)}.css`);

    await mkdir(path.join(DIST, 'css'), { recursive: true });
    await writeFile(path.join(DIST, 'css', name), code, 'utf8');
    assets[`/css/${file}`] = `/css/${name}`;
  }

  log(`css: ${Object.values(assets).map((f) => path.basename(f)).join(', ')}`);
  return assets;
}

async function buildJs() {
  const result = await build({
    entryPoints: [path.join(SRC, 'js', 'main.js')],
    bundle: true,
    minify: true,
    target: ['es2019'],
    define: {},
    logLevel: 'warning',
    write: false
  });

  // esbuild's `define` only substitutes identifiers, so patch the string here.
  let code = result.outputFiles[0].text;

  if (!CONTACT_ENDPOINT) {
    log('js: CONTACT_ENDPOINT not set — form will show the email fallback');
  } else {
    log(`js: endpoint -> ${CONTACT_ENDPOINT}`);
  }

  code = code.replaceAll('__CONTACT_ENDPOINT__', CONTACT_ENDPOINT);

  const name = `main.${fingerprint(code)}.js`;
  await mkdir(path.join(DIST, 'js'), { recursive: true });
  await writeFile(path.join(DIST, 'js', name), code, 'utf8');
  log(`js: ${name}`);

  return { '/js/main.js': `/js/${name}` };
}

/** sha256-base64 of every inline <script> in the built HTML, in document order. */
function inlineScriptHashes(html) {
  const hashes = [];
  const re = /<script(?![^>]*\bsrc=)(?![^>]*\btype=(?!["']?text\/javascript))[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    hashes.push('sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64'));
  }
  return hashes;
}

function checkInlineScriptHashes(html) {
  const found = inlineScriptHashes(html);
  const unknown = found.filter((h) => !ALLOWED_INLINE_SCRIPT_HASHES.includes(h));

  if (unknown.length) {
    throw new Error(
      'inline script is not allow-listed in the CSP:\n' +
      unknown.map((h) => `  ${h}`).join('\n') +
      '\n\nAdd it to ALLOWED_INLINE_SCRIPT_HASHES in build.mjs and to script-src\n' +
      "in infra/cloudfront.tf, then re-run `terraform apply`, or the browser will\n" +
      'refuse to run it in production.'
    );
  }

  log(`html: ${found.length} inline script(s), hashes match the CSP`);
}

/* A <use> pointing at a symbol that is not in the sprite renders nothing at
 * all — no error, no fallback, just a gap where an icon should be. Cheap to
 * catch here instead of noticing it on the deployed page. */
function checkSpriteRefs(html) {
  const defined = new Set([...html.matchAll(/<symbol\s+id="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...html.matchAll(/<use\s+href="#([^"]+)"/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !defined.has(id));

  if (missing.length) {
    throw new Error(`sprite symbols referenced but not defined: ${missing.join(', ')}`);
  }

  const unused = [...defined].filter((id) => !used.has(id));
  if (unused.length) log(`html: note — ${unused.length} unused sprite symbol(s): ${unused.join(', ')}`);

  log(`html: ${used.size} sprite symbols referenced, all defined`);
}

/* `<!-- include: partials/x.html -->` is expanded in place. The sprite is the
 * only partial today, and it exists so the English and German pages carry the
 * same icons without either file owning a copy of 40 KB of paths. */
async function expandIncludes(html) {
  const re = /^[ \t]*<!--\s*include:\s*([\w./-]+)\s*-->[ \t]*$/gm;
  const names = [...html.matchAll(re)].map((m) => m[1]);
  let out = html;

  for (const name of names) {
    const partial = await readFile(path.join(SRC, name), 'utf8');
    out = out.replace(
      new RegExp(`^[ \\t]*<!--\\s*include:\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-->[ \\t]*$`, 'm'),
      () => partial.trimEnd()
    );
  }

  return { html: out, count: names.length };
}

async function buildPage(page, assets) {
  const src = await readFile(path.join(SRC, page), 'utf8');
  const { html, count } = await expandIncludes(src);
  let out = minifyHtml(html);

  checkSpriteRefs(out);

  for (const [from, to] of Object.entries(assets)) {
    const before = out;
    out = out.replaceAll(`"${from}"`, `"${to}"`);
    if (out === before) throw new Error(`${page} does not reference "${from}"`);
  }

  checkInlineScriptHashes(out);

  const dest = path.join(DIST, page);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, out, 'utf8');
  log(`html: ${page} written (${count} include(s), ${Object.keys(assets).length} asset refs)`);
}

async function buildHtml(assets) {
  for (const page of PAGES) await buildPage(page, assets);
}

async function copyStatic() {
  for (const dir of STATIC_DIRS) {
    const from = path.join(SRC, dir);
    if (!existsSync(from)) continue;
    await cp(from, path.join(DIST, dir), { recursive: true });
  }
  log(`static: ${STATIC_DIRS.join(', ')} copied`);
}

async function buildSite() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  // HTML last: it needs the fingerprinted filenames the other two produce.
  const [css, js] = await Promise.all([buildCss(), buildJs()]);
  await buildHtml({ ...css, ...js });
  await copyStatic();
  log(`site -> ${path.relative(ROOT, DIST)}`);
}

async function buildLambda() {
  await rm(LAMBDA_OUT, { recursive: true, force: true });
  await mkdir(LAMBDA_OUT, { recursive: true });

  // Bundle the SES client in rather than trusting the runtime to provide it.
  await build({
    entryPoints: [LAMBDA_SRC],
    outfile: path.join(LAMBDA_OUT, 'index.mjs'),
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'esm',
    target: ['node20'],
    // Shim for CJS deps that reference require() inside an ESM bundle.
    banner: {
      js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);"
    },
    logLevel: 'warning'
  });

  log(`lambda -> ${path.relative(ROOT, LAMBDA_OUT)}/index.mjs`);
}

async function main() {
  if (!lambdaOnly) await buildSite();
  if (!siteOnly) await buildLambda();

  if (!isWatch) return;

  log('watching src/ …');
  const watcher = watch(SRC, { recursive: true });
  let pending;

  for await (const _event of watcher) {
    clearTimeout(pending);
    pending = setTimeout(() => {
      buildSite().catch((err) => console.error('[build] failed:', err.message));
    }, 120);
  }
}

main().catch((err) => {
  console.error('[build] failed:', err);
  process.exit(1);
});
