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

async function buildCss() {
  const files = ['fonts.css', 'style.css'];

  for (const file of files) {
    // No bundling: url() references pass through so ../fonts/* stays intact.
    await build({
      entryPoints: [path.join(SRC, 'css', file)],
      outfile: path.join(DIST, 'css', file),
      minify: true,
      logLevel: 'warning'
    });
  }

  log(`css: ${files.join(', ')} minified`);
}

async function buildJs() {
  const result = await build({
    entryPoints: [path.join(SRC, 'js', 'main.js')],
    outfile: path.join(DIST, 'js', 'main.js'),
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

  await mkdir(path.join(DIST, 'js'), { recursive: true });
  await writeFile(path.join(DIST, 'js', 'main.js'), code, 'utf8');
}

async function buildHtml() {
  const html = await readFile(path.join(SRC, 'index.html'), 'utf8');
  await writeFile(path.join(DIST, 'index.html'), minifyHtml(html), 'utf8');
  log('html: index.html written');
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
  await Promise.all([buildCss(), buildJs(), buildHtml()]);
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
