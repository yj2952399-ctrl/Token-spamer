const ALLOW = ['discord.com', 'discordapp.com', 'api.mail.tm', 'click.discord.com',
               'cdn.discordapp.com', '2captcha.com', 'api.yescaptcha.com'];
const FWD = ['content-type', 'authorization', 'x-super-properties', 'x-discord-locale',
             'x-discord-timezone', 'user-agent', 'proxy-authorization'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const target = req.query.url;
  if (!target) return res.status(400).send('missing url');
  if (process.env.PROXY_KEY && req.query.key !== process.env.PROXY_KEY) return res.status(403).send('forbidden');

  const t = new URL(target);
  if (!ALLOW.includes(t.hostname)) return res.status(403).send('host not allowed');

  const headers = {};
  for (const k of FWD) if (req.headers[k]) headers[k] = req.headers[k];

  let dest = target;
  const up = req.headers['x-upstream-proxy'];
  if (up) {
    const [h, p, user, pass] = up.split(':');
    dest = `http://${h}:${p}${t.pathname}${t.search}`;
    if (user) headers['proxy-authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  }

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : req.body;
  const r = await fetch(dest, { method: req.method, headers, body });
  r.headers.forEach((v, k) => res.setHeader(k, v));
  res.status(r.status);
  res.send(Buffer.from(await r.arrayBuffer()));
}