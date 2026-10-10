const crypto = require('node:crypto');

const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const adminKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const enabled = Boolean(base && apiKey);
const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
const cookieFlags = `; HttpOnly; SameSite=Lax; Path=/${secure}`;

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let value = '';
    req.on('data', chunk => {
      value += chunk;
      if (value.length > 8_000_000) reject(new ApiError(413, 'Request is too large.'));
    });
    req.on('end', () => {
      try { resolve(value ? JSON.parse(value) : {}); }
      catch { reject(new ApiError(400, 'Invalid request data.')); }
    });
    req.on('error', reject);
  });
}

function readCookie(req, name) {
  const entry = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function clearCookies() {
  return [
    `outfitai_access=;${cookieFlags}; Max-Age=0`,
    `outfitai_refresh=;${cookieFlags}; Max-Age=0`
  ];
}

function sessionCookies(session) {
  const accessAge = Math.max(60, Math.min(Number(session.expires_in) || 3600, 60 * 60 * 24));
  return [
    `outfitai_access=${encodeURIComponent(session.access_token)}${cookieFlags}; Max-Age=${accessAge}`,
    `outfitai_refresh=${encodeURIComponent(session.refresh_token)}${cookieFlags}; Max-Age=2592000`
  ];
}

async function request(path, { token, method = 'GET', body, raw, contentType, admin = false } = {}) {
  if (!enabled) throw new ApiError(503, 'Persistent storage is not configured yet.');
  if (admin && !adminKey) throw new ApiError(503, 'Account deletion is unavailable until the server admin key is configured.');
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        apikey: admin ? adminKey : apiKey,
        ...(token ? { Authorization: `Bearer ${token}` } : admin && !adminKey.startsWith('sb_secret_') ? { Authorization: `Bearer ${adminKey}` } : {}),
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(method !== 'GET' && method !== 'HEAD' && !path.startsWith('/auth/') && !path.startsWith('/storage/') ? { Prefer: 'return=representation' } : {})
      },
      ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {})
    });
  } catch {
    throw new ApiError(503, 'Could not reach persistent storage. Please try again shortly.');
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || 'The request could not be completed.';
    const status = response.status === 429 ? 429 : response.status >= 500 ? 503 : response.status;
    throw new ApiError(status, String(message).slice(0, 240));
  }
  return data;
}

async function authUser(token) {
  return request('/auth/v1/user', { token });
}

async function refreshSession(refreshToken) {
  if (!refreshToken) return null;
  return request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } });
}

async function currentUser(req, res) {
  let access = readCookie(req, 'outfitai_access');
  const refresh = readCookie(req, 'outfitai_refresh');
  if (!access && !refresh) return null;
  try {
    let authUserData;
    try { authUserData = await authUser(access); }
    catch (error) {
      if (error.status !== 401 || !refresh) throw error;
      const next = await refreshSession(refresh);
      if (!next?.access_token) throw error;
      access = next.access_token;
      res.setHeader('Set-Cookie', sessionCookies(next));
      authUserData = next.user;
    }
    if (!authUserData?.id) return null;
    return { id: authUserData.id, email: authUserData.email, access };
  } catch (error) {
    if (error.status === 401 || error.status === 403) res.setHeader('Set-Cookie', clearCookies());
    if (error.status === 503) throw error;
    return null;
  }
}

async function profileFor(user) {
  const rows = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,name,email,preferences`, { token: user.access });
  const row = rows?.[0];
  return row || { id: user.id, name: '', email: user.email || '', preferences: {} };
}

function publicUser(row, fallback = {}) {
  return { id: row.id, name: row.name || fallback.name || '', email: row.email || fallback.email || '', preferences: row.preferences || {} };
}

function toItem(row) {
  return {
    id: row.id, userId: row.user_id, name: row.name, category: row.category,
    color: row.color, style: row.style, season: row.season, occasion: row.occasion,
    brand: row.brand, favorite: row.favorite, wears: row.wears,
    imagePath: row.image_path, createdAt: row.created_at, image: ''
  };
}

function fromItem(body, userId, id = crypto.randomUUID()) {
  return {
    id, user_id: userId, name: String(body.name || '').trim(), category: body.category,
    color: body.color || 'Unspecified', style: body.style || 'Everyday',
    season: body.season || 'All season', occasion: body.occasion || 'Everyday',
    brand: body.brand || '', favorite: Boolean(body.favorite), wears: Number(body.wears) || 0
  };
}

function safePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

async function signImage(path, user) {
  if (!path) return '';
  const result = await request(`/storage/v1/object/sign/wardrobe/${safePath(path)}`, {
    token: user.access, method: 'POST', body: { expiresIn: 3600 }
  });
  const signedPath = String(result.signedURL || '');
  const storagePath = signedPath.startsWith('/storage/v1/') ? signedPath : `/storage/v1${signedPath.startsWith('/') ? signedPath : `/${signedPath}`}`;
  return new URL(storagePath, base).toString();
}

async function hydrateItems(rows, user) {
  return Promise.all(rows.map(async row => {
    const item = toItem(row);
    item.image = await signImage(item.imagePath, user);
    delete item.imagePath;
    return item;
  }));
}

function parseImage(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new ApiError(400, 'Choose a valid JPG, PNG, WEBP or GIF image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 5_000_000) throw new ApiError(413, 'Image must be smaller than 5 MB.');
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[match[1]];
  return { bytes, mime: match[1], extension };
}

async function uploadImage(user, id, dataUrl) {
  const image = parseImage(dataUrl);
  if (!image) return '';
  const path = `${user.id}/${id}.${image.extension}`;
  await request(`/storage/v1/object/wardrobe/${safePath(path)}`, {
    token: user.access, method: 'POST', raw: image.bytes, contentType: image.mime
  });
  return path;
}

async function removeImages(user, paths) {
  const clean = [...new Set(paths.filter(Boolean))];
  if (clean.length) await request('/storage/v1/object/wardrobe', { token: user.access, method: 'DELETE', body: { prefixes: clean } });
}

async function listRows(table, query, user) {
  return request(`/rest/v1/${table}?${query}`, { token: user.access });
}

function itemSummary(row) {
  return { id: row.id, name: row.name, category: row.category, color: row.color, style: row.style };
}

async function recommendation(user, options) {
  const rows = await listRows('wardrobe_items', 'select=*&order=created_at.asc', user);
  const items = rows.map(toItem);
  if (!items.length) throw new ApiError(400, 'Add a few pieces to your wardrobe first.');
  const groups = { Tops: [], Bottoms: [], Dresses: [], Outerwear: [], Shoes: [], Accessories: [], Bags: [] };
  items.forEach(item => (groups[item.category] || groups.Accessories).push(item));
  const pool = Object.values(groups).flat();
  const picks = [];
  const seed = (options.occasion || 'everyday').length + (options.style || 'minimalist').length;
  for (let n = 0; n < 3; n++) {
    const chosen = [];
    const put = category => { if (groups[category]?.length) chosen.push(groups[category][(seed + n + chosen.length) % groups[category].length]); };
    if (groups.Dresses?.length && n === 2) put('Dresses');
    else { put('Tops'); put('Bottoms'); }
    put('Outerwear'); put('Shoes'); put('Accessories');
    if (chosen.length < 2) pool.slice(n, n + 2).forEach(item => { if (!chosen.includes(item)) chosen.push(item); });
    picks.push({
      id: crypto.randomUUID(), name: ['The easy classic', 'A little more polished', 'Off-duty, elevated'][n],
      itemIds: chosen.map(item => item.id), score: Math.min(97, 76 + chosen.length * 3 + (options.occasion ? 3 : 0)),
      why: `A ${options.style || 'versatile'} combination for ${options.occasion || 'everyday'}—built from ${chosen.length} pieces in your closet.`,
      colorNote: `${chosen.map(item => item.color).filter(Boolean).join(' + ') || 'Your chosen palette'} creates a considered palette.`,
      tip: options.weather === 'Rainy' ? 'Add a water-resistant layer if you own one.' : 'Finish with an accessory you already love.',
      occasion: options.occasion || 'Everyday', weather: options.weather || 'Not specified',
      itemNames: chosen.map(itemSummary), createdAt: new Date().toISOString()
    });
  }
  return picks;
}

function mapOutfit(row, itemIds = []) {
  return {
    id: row.id, name: row.name, itemIds, score: row.score, why: row.why,
    colorNote: row.color_note, tip: row.tip, occasion: row.occasion,
    weather: row.weather, savedAt: row.saved_at, saved: true
  };
}

function errorResponse(res, error) {
  const status = Number(error.status) || 500;
  send(res, status, { error: status >= 500 ? (status === 503 ? error.message : 'Something went wrong. Please try again.') : error.message });
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === 'GET' && pathname === '/api/config') return send(res, 200, { mode: 'persistent', provider: 'Supabase' });
    if (req.method === 'POST' && pathname === '/api/signup') {
      const body = await readBody(req);
      if (!body.name?.trim() || !/^\S+@\S+\.\S+$/.test(body.email || '') || (body.password || '').length < 8) throw new ApiError(400, 'Add your name, a valid email and a password with at least 8 characters.');
      const result = await request('/auth/v1/signup', { method: 'POST', body: { email: body.email.trim().toLowerCase(), password: body.password, data: { name: body.name.trim() } } });
      const auth = result.session || result;
      if (auth.access_token && auth.refresh_token) {
        const user = { id: result.user?.id || result.id, email: result.user?.email || result.email, access: auth.access_token };
        let profile;
        for (let attempt = 0; attempt < 3; attempt++) {
          profile = await profileFor(user);
          if (profile.name) break;
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
        return send(res, 201, { user: publicUser(profile, { name: body.name.trim(), email: body.email }), mode: 'persistent' }, { 'Set-Cookie': sessionCookies(auth) });
      }
      return send(res, 201, { user: { name: body.name.trim(), email: body.email.trim().toLowerCase() }, confirmationRequired: true, mode: 'persistent' });
    }
    if (req.method === 'POST' && pathname === '/api/login') {
      const body = await readBody(req);
      const session = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: String(body.email || '').trim().toLowerCase(), password: body.password || '' } });
      const user = { id: session.user.id, email: session.user.email, access: session.access_token };
      const profile = await profileFor(user);
      return send(res, 200, { user: publicUser(profile, { email: user.email }) }, { 'Set-Cookie': sessionCookies(session) });
    }
    if (req.method === 'POST' && pathname === '/api/auth/callback') {
      const body = await readBody(req);
      if (!body.access_token || !body.refresh_token) throw new ApiError(400, 'The confirmation link is incomplete. Request a new email and try again.');
      const auth = await authUser(body.access_token);
      const user = { id: auth.id, email: auth.email, access: body.access_token };
      const profile = await profileFor(user);
      return send(res, 200, { user: publicUser(profile, { email: auth.email }) }, { 'Set-Cookie': [
        `outfitai_access=${encodeURIComponent(body.access_token)}${cookieFlags}; Max-Age=3600`,
        `outfitai_refresh=${encodeURIComponent(body.refresh_token)}${cookieFlags}; Max-Age=2592000`
      ] });
    }
    if (req.method === 'POST' && pathname === '/api/recover') {
      const body = await readBody(req);
      if (!/^\S+@\S+\.\S+$/.test(body.email || '')) throw new ApiError(400, 'Enter a valid email address.');
      const redirectTo = new URL('/', req.headers.origin || `https://${req.headers.host}`).toString();
      await request(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email: body.email.trim().toLowerCase() } });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/logout') {
      const access = readCookie(req, 'outfitai_access');
      if (access) { try { await request('/auth/v1/logout', { token: access, method: 'POST' }); } catch {} }
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookies() });
    }

    const user = await currentUser(req, res);
    if (req.method === 'GET' && pathname === '/api/session') {
      if (!user) return send(res, 200, { user: null, mode: 'persistent' }, { 'Set-Cookie': clearCookies() });
      const profile = await profileFor(user);
      return send(res, 200, { user: publicUser(profile, { email: user.email }), mode: 'persistent' });
    }
    if (!user) throw new ApiError(401, 'Sign in to continue.');

    if (req.method === 'POST' && pathname === '/api/password') {
      const body = await readBody(req);
      if (String(body.password || '').length < 8) throw new ApiError(400, 'Choose a password with at least 8 characters.');
      await request('/auth/v1/user', { token: user.access, method: 'PUT', body: { password: body.password } });
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/items') {
      const rows = await listRows('wardrobe_items', 'select=*&order=created_at.desc', user);
      return send(res, 200, { items: await hydrateItems(rows, user) });
    }
    if (req.method === 'POST' && pathname === '/api/items') {
      const body = await readBody(req);
      if (!body.name?.trim() || !body.category) throw new ApiError(400, 'Item name and category are required.');
      const row = fromItem(body, user.id);
      row.image_path = await uploadImage(user, row.id, body.image);
      try {
        const created = await request('/rest/v1/wardrobe_items?select=*', { token: user.access, method: 'POST', body: row });
        return send(res, 201, { item: (await hydrateItems(created, user))[0] });
      } catch (error) {
        if (row.image_path) await removeImages(user, [row.image_path]).catch(() => {});
        throw error;
      }
    }
    const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
    if (itemMatch) {
      const itemId = encodeURIComponent(itemMatch[1]);
      if (req.method === 'DELETE') {
        const existing = await listRows('wardrobe_items', `select=image_path&id=eq.${itemId}`, user);
        if (!existing.length) throw new ApiError(404, 'Item not found.');
        await request(`/rest/v1/wardrobe_items?id=eq.${itemId}`, { token: user.access, method: 'DELETE' });
        await removeImages(user, [existing[0].image_path]);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const allowed = ['name', 'category', 'color', 'style', 'season', 'occasion', 'brand', 'favorite'];
        const row = Object.fromEntries(allowed.filter(key => body[key] !== undefined).map(key => [key === 'favorite' ? key : key, body[key]]));
        if (row.name !== undefined) row.name = String(row.name).trim();
        const changed = await request(`/rest/v1/wardrobe_items?id=eq.${itemId}&select=*`, { token: user.access, method: 'PATCH', body: row });
        if (!changed.length) throw new ApiError(404, 'Item not found.');
        return send(res, 200, { item: (await hydrateItems(changed, user))[0] });
      }
    }
    if (req.method === 'PATCH' && pathname === '/api/profile') {
      const body = await readBody(req);
      const current = await profileFor(user);
      const preferences = { ...(current.preferences || {}) };
      for (const key of ['styles', 'colors', 'occasions', 'city', 'weather', 'genderPresentation']) if (body[key] !== undefined) preferences[key] = body[key];
      const update = { preferences };
      if (body.name !== undefined) update.name = String(body.name).trim();
      const rows = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,name,email,preferences`, { token: user.access, method: 'PATCH', body: update });
      return send(res, 200, { user: publicUser(rows[0] || { ...current, ...update }) });
    }
    if (req.method === 'POST' && pathname === '/api/recommend') {
      const options = await readBody(req);
      return send(res, 200, { outfits: await recommendation(user, options), mode: 'wardrobe-rules' });
    }
    if (req.method === 'GET' && pathname === '/api/outfits') {
      const outfits = await listRows('saved_outfits', 'select=*&order=saved_at.desc', user);
      if (!outfits.length) return send(res, 200, { outfits: [] });
      const ids = outfits.map(row => row.id).join(',');
      const relations = await listRows('outfit_items', `select=outfit_id,item_id&outfit_id=in.(${ids})`, user);
      const byOutfit = new Map();
      relations.forEach(row => byOutfit.set(row.outfit_id, [...(byOutfit.get(row.outfit_id) || []), row.item_id]));
      return send(res, 200, { outfits: outfits.map(row => mapOutfit(row, byOutfit.get(row.id) || [])) });
    }
    if (req.method === 'POST' && pathname === '/api/outfits') {
      const body = await readBody(req);
      const itemIds = [...new Set(Array.isArray(body.itemIds) ? body.itemIds : [])];
      if (itemIds.length) {
        const owned = await listRows('wardrobe_items', `select=id&id=in.(${itemIds.map(encodeURIComponent).join(',')})`, user);
        if (owned.length !== itemIds.length) throw new ApiError(400, 'Outfits can only use items from your wardrobe.');
      }
      const rows = await request('/rest/v1/saved_outfits?select=*', { token: user.access, method: 'POST', body: {
        user_id: user.id, name: String(body.name || 'Saved look').slice(0, 120), score: Number(body.score) || 0,
        why: String(body.why || ''), color_note: String(body.colorNote || ''), tip: String(body.tip || ''),
        occasion: String(body.occasion || 'Everyday'), weather: String(body.weather || 'Not specified')
      } });
      const saved = rows[0];
      try {
        if (itemIds.length) await request('/rest/v1/outfit_items', { token: user.access, method: 'POST', body: itemIds.map(item_id => ({ user_id: user.id, outfit_id: saved.id, item_id })) });
      } catch (error) {
        await request(`/rest/v1/saved_outfits?id=eq.${saved.id}`, { token: user.access, method: 'DELETE' }).catch(() => {});
        throw error;
      }
      return send(res, 201, { outfit: { ...mapOutfit(saved, itemIds), saved: true } });
    }
    if (req.method === 'GET' && pathname === '/api/plans') {
      const rows = await listRows('outfit_plans', 'select=*&order=date.asc', user);
      return send(res, 200, { plans: rows.map(row => ({ id: row.id, outfitId: row.outfit_id, title: row.title, date: row.date, occasion: row.occasion, notes: row.notes })) });
    }
    if (req.method === 'POST' && pathname === '/api/plans') {
      const body = await readBody(req);
      if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new ApiError(400, 'Choose a valid date.');
      const outfit = await listRows('saved_outfits', `select=id&id=eq.${encodeURIComponent(body.outfitId || '')}`, user);
      if (!outfit.length) throw new ApiError(400, 'Choose one of your saved outfits.');
      const rows = await request('/rest/v1/outfit_plans?select=*', { token: user.access, method: 'POST', body: {
        user_id: user.id, outfit_id: outfit[0].id, title: String(body.title || 'Planned outfit').slice(0, 120),
        date: body.date, occasion: String(body.occasion || ''), notes: String(body.notes || '')
      } });
      const row = rows[0];
      return send(res, 201, { plan: { id: row.id, outfitId: row.outfit_id, title: row.title, date: row.date, occasion: row.occasion, notes: row.notes } });
    }
    if (req.method === 'DELETE' && pathname === '/api/account') {
      if (!adminKey) throw new ApiError(503, 'Account deletion needs the server-only Supabase secret key.');
      const owned = await listRows('wardrobe_items', 'select=image_path', user);
      await removeImages(user, owned.map(row => row.image_path));
      await request(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', admin: true });
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookies() });
    }
    if (pathname.startsWith('/api/')) throw new ApiError(404, 'Not found.');
  } catch (error) {
    return errorResponse(res, error);
  }
  return false;
}

module.exports = { enabled, handleApi };
