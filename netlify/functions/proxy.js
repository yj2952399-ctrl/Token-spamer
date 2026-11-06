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

const err = (msg, status) => ({
  statusCode: status,
  headers: { ...cors, 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: msg }),
});

// undici の ProxyAgent が使えれば CONNECT で HTTPS を正しく中継する。
// 使えない環境では従来の URL 書き換えにフォールバックする。
let ProxyAgentCls = null;
async function agentFor(up) {
  if (!up) return undefined;
  if (!ProxyAgentCls) {
    try { ({ ProxyAgent: ProxyAgentCls } = await import('undici')); } catch { return undefined; }
  }
  const [h, p, user, pass] = up.split(':');
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass || '')}@` : '';
  return new ProxyAgentCls(`http://${auth}${h}:${p}`);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const q = event.queryStringParameters || {};
  if (!q.url) return err('missing url', 400);
  if (process.env.PROXY_KEY && q.key !== process.env.PROXY_KEY) return err('forbidden', 403);

  let t;
  try { t = new URL(q.url); } catch { return err('bad url', 400); }
  if (!ALLOW.has(t.hostname)) return err('host not allowed', 403);

  const headers = {};
  for (const k of FWD) if (event.headers[k]) headers[k] = event.headers[k];
  if (headers['x-discord-cookie']) headers.cookie = headers['x-discord-cookie'];

  const up = event.headers['x-upstream-proxy'];
  const dispatcher = await agentFor(up);
  let dest = t.toString();
  if (up && !dispatcher) {
    const [h, p, user, pass] = up.split(':');
    if (h && p) {
      dest = `http://${h}:${p}${t.pathname}${t.search}`;
      headers.host = t.host;
      if (user) {
        headers['proxy-authorization'] =
          'Basic ' + Buffer.from(`${user}:${pass || ''}`).toString('base64');
      }
    }
  }

  const raw = event.body || '';
  const buf = event.isBase64Encoded ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
  const body = ['GET', 'HEAD'].includes(event.httpMethod) || buf.length === 0 ? undefined : buf;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);

  let r;
  try {
    r = await fetch(dest, {
      method: event.httpMethod,
      headers,
      body,
      signal: ctl.signal,
      redirect: 'manual',
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (e) {
    return err('upstream: ' + String(e), 502);
  } finally {
    clearTimeout(timer);
  }

  const out = { ...cors };
  const mv = {};
  r.headers.forEach((v, k) => {
    if (HOP.has(k.toLowerCase())) return;
    out[k] = v;
  });
  const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  if (sc.length) mv['set-cookie'] = sc;

  return {
    statusCode: r.status,
    headers: out,
    multiValueHeaders: mv,
    body: Buffer.from(await r.arrayBuffer()).toString('base64'),
    isBase64Encoded: true,
  };
};