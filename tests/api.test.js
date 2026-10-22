import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { buildContents, extractCitations, makeInstructions } from '../api/index.js';

function mockRes() {
  return { headers: {}, statusCode: 200, body: '', setHeader(k,v){this.headers[k]=v;}, end(s=''){this.body=s;}, json(){return JSON.parse(this.body);} };
}
test('GET returns service health and CORS headers', async () => {
  const req = { method: 'GET', headers: { origin: 'https://appassets.androidplatform.net' } };
  const res = mockRes(); await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://appassets.androidplatform.net');
  assert.equal(res.json().service, 'questsheet-ai-bot');
});
test('OPTIONS responds without contacting Gemini', async () => {
  const res = mockRes(); await handler({ method: 'OPTIONS', headers: {} }, res);
  assert.equal(res.statusCode, 204);
});
test('POST validates empty message', async () => {
  const res = mockRes(); await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /текст сообщения/i);
});
test('POST explains missing server key', async () => {
  const old = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  const res = mockRes(); await handler({ method: 'POST', headers: {}, body: { message: 'test' } }, res);
  assert.equal(res.statusCode, 503);
  if (old) process.env.GEMINI_API_KEY = old;
});
test('history and final message are not duplicated', () => {
  const r = buildContents({ message: 'Привет', history: [{ role: 'user', content: 'Привет' }] });
  assert.equal(r.contents.length, 1);
});
test('edition instructions distinguish 2014 and 2024', () => {
  const p = makeInstructions({ edition: 'both', sourceMode: 'mixed', character: '', customInstructions: '' });
  assert.match(p, /2014 и 2024/);
  assert.match(p, /НЕОФИЦИАЛЬНЫЕ/);
});
test('citation parser extracts grounded links', () => {
  const c = extractCitations({ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://www.dndbeyond.com/sources/test', title: 'Official' } }] } });
  assert.equal(c.length, 1); assert.equal(c[0].title, 'Official');
});
