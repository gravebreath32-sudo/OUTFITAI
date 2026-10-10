const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://outfitai-test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-publishable-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-server-secret';
process.env.NODE_ENV = 'test';

const uid = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const outfitId = '33333333-3333-4333-8333-333333333333';
const user = { id: uid, email: 'alex@example.com', user_metadata: { name: 'Alex' } };
const profile = { id: uid, name: 'Alex', email: user.email, preferences: { styles: ['Minimalist'] } };
const items = [];
const outfits = [];
const joins = [];
const plans = [];
const calls = [];

function result(data, status = 200) { return new Response(data === null ? null : JSON.stringify(data), { status }); }
function json(options) { return options.body ? JSON.parse(options.body) : null; }
function rowItem(data) { return { ...data, id: itemId, created_at: '2026-10-10T00:00:00.000Z', image_path: data.image_path || null }; }

global.fetch = async (input, options = {}) => {
  const url = new URL(input);
  calls.push({ url, options });
  if (options.headers?.apikey !== 'test-publishable-key' && options.headers?.apikey !== 'test-server-secret') throw Error('Missing Supabase API key.');
  if (url.pathname === '/auth/v1/signup') return result({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, user });
  if (url.pathname === '/auth/v1/user') return options.headers.Authorization === 'Bearer test-access' ? result(user) : result({ message: 'Unauthorized' }, 401);
  if (url.pathname === '/auth/v1/logout') return result(null, 204);
  if (url.pathname === '/rest/v1/profiles') return result([profile]);
  if (url.pathname === '/rest/v1/wardrobe_items') {
    if (options.method === 'POST') { items.push(rowItem(json(options))); return result(items); }
    if (options.method === 'GET' && url.searchParams.get('select') === 'id') return result(items.map(x => ({ id: x.id })));
    if (options.method === 'GET' && url.searchParams.get('select') === 'image_path') return result(items.map(x => ({ image_path: x.image_path })));
    if (options.method === 'GET') return result(items);
  }
  if (url.pathname === '/rest/v1/saved_outfits') {
    if (options.method === 'POST') { outfits.push({ ...json(options), id: outfitId, saved_at: '2026-10-10T00:00:00.000Z' }); return result([outfits.at(-1)]); }
    if (options.method === 'GET') return result(outfits);
    if (options.method === 'DELETE') return result(null, 204);
  }
  if (url.pathname === '/rest/v1/outfit_items') {
    if (options.method === 'POST') { joins.push(...json(options)); return result(joins); }
    if (options.method === 'GET') return result(joins.map(x => ({ outfit_id: x.outfit_id, item_id: x.item_id })));
  }
  if (url.pathname === '/rest/v1/outfit_plans') {
    if (options.method === 'POST') { plans.push({ ...json(options), id: '44444444-4444-4444-8444-444444444444' }); return result(plans); }
    if (options.method === 'GET') return result(plans);
  }
  if (url.pathname === '/auth/v1/admin/users/' + uid) return result(null, 204);
  throw Error(`Unexpected Supabase request: ${options.method || 'GET'} ${url.pathname}${url.search}`);
};

const provider = require('../supabase-provider');
assert.equal(provider.enabled, true);

async function call(method, path, body, cookie = '') {
  const { PassThrough } = require('node:stream');
  const req = new PassThrough();
  req.method = method;
  req.url = path;
  req.headers = { cookie, origin: 'https://outfitai.example', host: 'outfitai.example' };
  const res = {
    status: 0, headers: {}, data: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(content) { this.data = content || ''; }
  };
  const done = provider.handleApi(req, res, path);
  req.end(body === undefined ? '' : JSON.stringify(body));
  await done;
  return { ...res, json: res.data ? JSON.parse(res.data) : null };
}

function cookieHeader(response) {
  return response.headers['Set-Cookie'].map(cookie => cookie.split(';')[0]).join('; ');
}

(async () => {
  const signup = await call('POST', '/api/signup', { name: 'Alex', email: user.email, password: 'wardrobe-test-password' });
  assert.equal(signup.status, 201);
  assert.equal(signup.json.mode, 'persistent');
  const cookie = cookieHeader(signup);
  const item = await call('POST', '/api/items', { name: 'Black jeans', category: 'Bottoms', color: 'Black' }, cookie);
  assert.equal(item.status, 201);
  assert.equal(item.json.item.name, 'Black jeans');
  const recommendations = await call('POST', '/api/recommend', { occasion: 'College', style: 'Casual' }, cookie);
  assert.equal(recommendations.status, 200);
  assert.equal(recommendations.json.outfits.length, 3);
  assert.ok(recommendations.json.outfits.every(look => look.itemIds.every(id => items.some(piece => piece.id === id))));
  const saved = await call('POST', '/api/outfits', { name: 'Easy classic', itemIds: [itemId], score: 90 }, cookie);
  assert.equal(saved.status, 201);
  assert.deepEqual(saved.json.outfit.itemIds, [itemId]);
  const list = await call('GET', '/api/outfits', undefined, cookie);
  assert.deepEqual(list.json.outfits[0].itemIds, [itemId]);
  assert.ok(calls.filter(x => x.url.pathname.startsWith('/rest/v1/')).every(x => x.options.headers.Authorization === 'Bearer test-access'));
  assert.ok(!/test-server-secret/.test(require('node:fs').readFileSync(require.resolve('../public/app.js'), 'utf8')));
  console.log('Supabase adapter smoke test passed (mocked provider; no live credentials used).');
})().catch(error => { console.error(error); process.exitCode = 1; });
