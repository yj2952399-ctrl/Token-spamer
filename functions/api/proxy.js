const ALLOW = ['discord.com', 'discordapp.com', 'api.mail.tm', 'click.discord.com',
               'cdn.discordapp.com', '2captcha.com', 'api.yescaptcha.com'];
const FWD = ['content-type', 'authorization', 'x-super-properties', 'x-discord-locale',
             'x-discord-timezone', 'user-agent', 'proxy-authorization'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const u = new URL(request.url);
  const target = u.searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400, headers: cors });

  if (env.PROXY_KEY && u.searchParams.get('key') !== env.PROXY_KEY)
    return new Response('forbidden', { status: 403, headers: cors });

  const t = new URL(target);
  if (!ALLOW.includes(t.hostname)) return new Response('host not allowed', { status: 403, headers: cors });

  const headers = new Headers();
  for (const k of FWD) {
    const v = request.headers.get(k);
    if (v) headers.set(k, v);
  }

  let dest = target;
  const up = request.headers.get('x-upstream-proxy');
  if (up) {
    const [h, p, user, pass] = up.split(':');
    dest = `http://${h}:${p}${t.pathname}${t.search}`;
    if (user) headers.set('proxy-authorization', 'Basic ' + btoa(`${user}:${pass}`));
  }

  const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.text();
  const res = await fetch(dest, { method: request.method, headers, body });

  const out = new Headers(res.headers);
  Object.entries(cors).forEach(([k, v]) => out.set(k, v));
  return new Response(res.body, { status: res.status, headers: out });
}