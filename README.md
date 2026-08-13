# berqiqch.de — portfolio

Personal site of Yassine Berqiqch, Full-Stack Software Engineer.

Static, no framework, no database. Hosted on S3 behind CloudFront; the contact
form is a Lambda function that sends via SES. The whole stack is described in
Terraform.

## Layout

```
src/                    site source
  index.html            English page
  de/index.html         German page, same structure and assets
  partials/sprite.html  inline SVG sprite, shared by both pages
  css/style.css         hand-written; fonts.css is generated
  js/main.js
  fonts/                self-hosted woff2 subsets
  images/  files/       photos, badges, CV and certificate PDFs
lambda/contact/
  index.mjs             SES handler
  test.mjs              unit checks, no AWS calls
infra/                  Terraform: S3, CloudFront, API Gateway, Lambda, SES, IAM
scripts/                fetch-fonts.mjs, build-tech-icons.mjs
build.mjs               minifies to dist/, bundles the lambda
.github/workflows/      deploy on push to main
```

## Commands

```bash
npm ci
npm test              # contact handler checks
npm run build         # dist/ + build/lambda/
npm run dev           # rebuild dist/ on change
npm run fonts         # re-download font subsets
npm run icons         # regenerate the brand marks in the sprite
```

Preview over HTTP, not `file://` — that breaks the font paths:

```bash
npx serve dist        # or: python -m http.server -d dist 8000
```

Deployment, SES verification and the custom-domain steps are in
[DEPLOY.md](DEPLOY.md).

## Notes on a few decisions

**No database.** The previous version of this site inserted every contact form
submission into MySQL and checked for duplicates with a `SELECT`. The submission
now exists only for the lifetime of one Lambda invocation: it is validated,
emailed, and forgotten. Nothing stores personal data, which is one fewer GDPR
obligation to reason about.

**Self-hosted fonts.** Inter and Space Grotesk are served from this origin
rather than `fonts.gstatic.com`. Embedding Google Fonts transmits the visitor's
IP address to a third party, which LG München I held to be a GDPR violation
(3 O 17493/20, 20 January 2022). Only the `latin` and `latin-ext` subsets are
shipped — 175 KB for four files.

**German is a page, not a toggle.** `/de/` is a separate document with its own
`lang`, `og:locale` and reciprocal `hreflang`, so both languages are crawlable
and neither carries the other's text. They share one stylesheet, one script and
one sprite; the few strings `main.js` shows a visitor come from `data-msg-*`
attributes in the markup rather than from the script, which is what keeps it
from needing a copy per language. Because the S3 origin is private behind OAC
rather than a website endpoint, `default_root_object` only resolves `/` — a
CloudFront Function appends `index.html` to any directory URI so `/de/` works
the same way.

**No icon font, no animation library.** The old build pulled Font Awesome and
AOS from a CDN for a handful of icons and some scroll effects. Icons are now an
inline SVG sprite and the reveal animation is about fifteen lines of
IntersectionObserver, both of which respect `prefers-reduced-motion`.

**Validation lives in the Lambda.** The client checks fields to give quick
feedback, but the function re-validates everything independently, strips CR/LF
from anything that reaches a mail header, and HTML-escapes the body. A honeypot
field catches naive bots; API Gateway throttling caps the rest.

**CORS is handled in the function, not by API Gateway.** Enabling both makes
each append its own `Access-Control-Allow-Origin`, and browsers reject the
duplicate. Keeping it in the handler also means it works unchanged behind a
Lambda Function URL. `ALLOWED_ORIGINS` is a list because the site answers on
both the custom domain and the CloudFront one; the handler echoes back whichever
listed origin called it and sets `Vary: Origin`. Matching is exact string
equality, so `https://www.berqiqch.de.evil.example` does not slip through.

## Licence

Source is free to read and learn from. The CV, certificates, photographs and
written content are not.

Inter and Space Grotesk are used under the SIL Open Font License 1.1.

Brand marks in the skills section come from [simple-icons](https://simpleicons.org)
(CC0-1.0) and are reduced to monochrome. Each logo remains a trademark of its
owner and is used only to identify the tool named beside it.
