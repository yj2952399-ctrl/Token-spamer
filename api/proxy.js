const ALLOW = new Set([
  'discord.com', 'discordapp.com', 'cdn.discordapp.com', 'click.discord.com',
  'api.mail.tm', '2captcha.com', 'api.yescaptcha.com',
  'api.proxyscrape.com', 'api.ipify.org', 'raw.githubusercontent.com',
  'proxylist.geonode.com',
]);

const FWD = [
  'content-type', 'authorization', 'x-super-properties', 'x-discord-locale',
  'x-discord-timezone', 'user-agent', 'accept', 'accept-language', 'cookie',
  'x-discord-cookie', 'x-fingerprint', 'x-captcha-key', 'x-captcha-rqtoken',
  'x-captcha-session-id', 'x-captcha-rqdata',
];

const HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-encoding',
  'content-length', 'proxy-connection', 'proxy-authenticate', 'te', 'trailer',
  'upgrade', 'host', 'set-cookie', 'x-upstream-proxy', 'x-discord-cookie',
  'proxy-authorization',
]);

const EXPOSE = [
  'set-cookie', 'retry-after',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'x-ratelimit-reset-after', 'x-ratelimit-scope', 'x-ratelimit-global',
  'x-ratelimit-bucket',
  'x-captcha-sitekey', 'x-captcha-rqdata', 'x-captcha-rqtoken',
  'x-captcha-session-id',
].join(', ');

// Vercel に body をパースさせない（パースされると fetch に渡せない）
export const config = { api: { bodyParser: false } };

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Expose-Headers', EXPOSE);
}

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const u = new URL(req.url, 'http://x');
  const target = u.searchParams.get('url');
  if (!target) return res.status(400).json({ error: 'missing url' });
  if (process.env.PROXY_KEY && u.searchParams.get('key') !== process.env.PROXY_KEY)
    return res.status(403).json({ error: 'forbidden' });

  let t;
  try { t = new URL(target); } catch { return res.status(400).json({ error: 'bad url' }); }
  if (!ALLOW.has(t.hostname)) return res.status(403).json({ error: 'host not allowed' });

  const headers = {};
  for (const k of FWD) if (req.headers[k]) headers[k] = req.headers[k];
  if (headers['x-discord-cookie']) headers.cookie = headers['x-discord-cookie'];

  let dest = t.toString();
  const up = req.headers['x-upstream-proxy'];
  if (up) {
    const [h, p, user, pass] = up.split(':');
    if (h && p) {
      dest = `http://${h}:${p}${t.pathname}${t.search}`;
      headers.host = t.host;
      if (user) headers['proxy-authorization'] = 'Basic ' + Buffer.from(`${user}:${pass || ''}`).toString('base64');
    }
  }

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readRaw(req);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);

  let r;
  try {
    r = await fetch(dest, { method: req.method, headers, body, signal: ctl.signal, redirect: 'manual' });
  } catch (e) {
    return res.status(502).json({ error: 'upstream: ' + String(e) });
  } finally {
    clearTimeout(timer);
  }

  r.headers.forEach((v, k) => {
    if (!HOP.has(k.toLowerCase())) res.setHeader(k, v);
  });
  const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  if (sc.length) res.setHeader('set-cookie', sc);

  res.status(r.status).send(Buffer.from(await r.arrayBuffer()));
}