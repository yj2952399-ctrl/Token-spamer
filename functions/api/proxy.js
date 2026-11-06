// /api/proxy?url=<target>&key=<PROXY_KEY>
const ALLOW = new Set([
  'discord.com', 'discordapp.com', 'cdn.discordapp.com', 'click.discord.com',
  'api.mail.tm', 'api.mail.gw', '2captcha.com', 'api.yescaptcha.com',
  'api.proxyscrape.com', 'api.ipify.org', 'raw.githubusercontent.com',
  'proxylist.geonode.com', 'api.openproxylist.xyz', 'www.proxy-list.download',
  'proxy-list.download',
]);

const FWD = [
  'content-type', 'authorization', 'x-super-properties', 'x-discord-locale',
  'x-discord-timezone', 'user-agent', 'accept', 'accept-language', 'cookie',
  'x-discord-cookie', 'x-fingerprint', 'x-captcha-key', 'x-captcha-rqtoken',
  'x-captcha-session-id', 'x-captcha-rqdata', 'origin', 'referer',
  'x-debug-options', 'x-discord-client-properties', 'priority',
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

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': EXPOSE,
};

const err = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

function b64(s) {
  try { return btoa(s); } catch { return btoa(unescape(encodeURIComponent(s))); }
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const u = new URL(request.url);
  const target = u.searchParams.get('url');
  if (!target) return err('missing url', 400);
  if (env.PROXY_KEY && u.searchParams.get('key') !== env.PROXY_KEY) return err('forbidden', 403);

  let t;
  try { t = new URL(target); } catch { return err('bad url', 400); }
  if (!ALLOW.has(t.hostname)) return err('host not allowed', 403);

  const headers = new Headers();
  for (const k of FWD) {
    const v = request.headers.get(k);
    if (v) headers.set(k, v);
  }
  const ck = headers.get('x-discord-cookie');
  if (ck) headers.set('cookie', ck);

  let dest = t.toString();
  const up = request.headers.get('x-upstream-proxy');
  if (up) {
    const [h, p, user, pass] = up.split(':');
    if (h && p) {
      dest = `http://${h}:${p}${t.pathname}${t.search}`;
      try { headers.set('host', t.host); } catch {}
      if (user) headers.set('proxy-authorization', 'Basic ' + b64(`${user}:${pass || ''}`));
    }
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);

  let res;
  try {
    res = await fetch(dest, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: ctl.signal,
      redirect: 'manual',
    });
  } catch (e) {
    return err('upstream: ' + String(e), 502);
  } finally {
    clearTimeout(timer);
  }

  const out = new Headers(cors);
  for (const [k, v] of res.headers) if (!HOP.has(k.toLowerCase())) out.set(k, v);
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of sc) out.append('set-cookie', c);

  return new Response(res.body, { status: res.status, headers: out });
}