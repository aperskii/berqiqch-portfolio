/**
 * Local checks for the contact handler.
 *
 *   node lambda/contact/test.mjs
 *
 * Every case here returns before SES is reached, except the two marked
 * "sends", which stub the SES client so nothing leaves the machine.
 */

import assert from 'node:assert/strict';

process.env.MAIL_TO = 'owner@example.com';
process.env.MAIL_FROM = 'noreply@example.com';
process.env.ALLOWED_ORIGIN = 'https://www.berqiqch.de';

const { handler } = await import('./index.mjs');

const ORIGIN = 'https://www.berqiqch.de';

function event(body, { origin = ORIGIN, method = 'POST' } = {}) {
  return {
    requestContext: { http: { method } },
    headers: { origin },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

const valid = {
  name: 'Anna Schmidt',
  email: 'anna@example.com',
  subject: 'Backend role',
  message: 'Hello, we have an opening that fits your Go experience. Interested?'
};

let passed = 0;
let failed = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok   ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL ${label}\n       ${err.message}`);
    failed++;
  }
}

console.log('\ncontact handler\n');

await check('OPTIONS preflight returns 204 with CORS headers', async () => {
  const res = await handler(event('', { method: 'OPTIONS' }));
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], ORIGIN);
});

await check('GET is rejected with 405', async () => {
  const res = await handler(event('', { method: 'GET' }));
  assert.equal(res.statusCode, 405);
});

await check('foreign origin is rejected with 403', async () => {
  const res = await handler(event(valid, { origin: 'https://evil.example' }));
  assert.equal(res.statusCode, 403);
});

await check('malformed JSON returns 400', async () => {
  const res = await handler(event('{not json'));
  assert.equal(res.statusCode, 400);
});

await check('JSON array body returns 400', async () => {
  const res = await handler(event([1, 2, 3]));
  assert.equal(res.statusCode, 400);
});

await check('oversized body returns 413', async () => {
  const res = await handler(event({ ...valid, message: 'x'.repeat(25000) }));
  assert.equal(res.statusCode, 413);
});

await check('missing name returns 400', async () => {
  const res = await handler(event({ ...valid, name: '' }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /Name is required/);
});

await check('invalid email returns 400', async () => {
  const res = await handler(event({ ...valid, email: 'not-an-email' }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /not valid/);
});

await check('email without TLD returns 400', async () => {
  const res = await handler(event({ ...valid, email: 'anna@localhost' }));
  assert.equal(res.statusCode, 400);
});

await check('too-short message returns 400', async () => {
  const res = await handler(event({ ...valid, message: 'hi' }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /at least 10/);
});

await check('over-long message returns 400 (not silently truncated)', async () => {
  const res = await handler(event({ ...valid, message: 'x'.repeat(5001) }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /maximum length/);
});

await check('filled honeypot returns 200 without sending', async () => {
  let sent = false;
  const res = await handler(event({ ...valid, company: 'SpamCo' }));
  assert.equal(res.statusCode, 200);
  assert.equal(sent, false);
});

// --- cases that reach SES: stub the client -------------------------------

const sesModule = await import('@aws-sdk/client-sesv2');
const sent = [];

sesModule.SESv2Client.prototype.send = async function (cmd) {
  sent.push(cmd.input);
  return { MessageId: 'stub-1' };
};

await check('valid submission sends one email with Reply-To set (sends)', async () => {
  sent.length = 0;
  const res = await handler(event(valid));
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].Destination.ToAddresses, ['owner@example.com']);
  assert.deepEqual(sent[0].ReplyToAddresses, ['anna@example.com']);
  assert.match(sent[0].Content.Simple.Subject.Data, /Backend role/);
});

await check('header injection in name cannot forge mail headers (sends)', async () => {
  sent.length = 0;
  const res = await handler(event({
    ...valid,
    name: 'Anna\r\nBcc: victim@example.com'
  }));
  assert.equal(res.statusCode, 200);
  const subject = sent[0].Content.Simple.Subject.Data;
  const html = sent[0].Content.Simple.Body.Html.Data;
  assert.ok(!subject.includes('\n') && !subject.includes('\r'), 'subject contains CR/LF');
  assert.ok(!/Bcc:/i.test(subject), 'Bcc leaked into subject');
  assert.equal(sent[0].Destination.ToAddresses.length, 1);
  assert.ok(!html.includes('<script'), 'unescaped HTML in body');
});

await check('HTML in message is escaped (sends)', async () => {
  sent.length = 0;
  await handler(event({ ...valid, message: 'Look: <script>alert(1)</script> and <b>bold</b>' }));
  const html = sent[0].Content.Simple.Body.Html.Data;
  assert.ok(html.includes('&lt;script&gt;'), 'script tag not escaped');
  assert.ok(!html.includes('<script>'), 'raw script tag present');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
