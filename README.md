# Token-spamer

Discord のアカウント生成 / 一斉参加 / 一斉スパムをブラウザから回すツール。

## 構成

- `public/index.html` … UI 本体（全部ここ）
- `functions/api/proxy.js` … Cloudflare Pages Function（`/api/proxy`）
- `netlify/functions/proxy.js` … Netlify Function
- `api/proxy.js` … Vercel Function

プロキシは Discord / mail.tm / captcha サービスの許可ホストのみ通す。
上流プロキシは `x-upstream-proxy` ヘッダで渡す（`host:port` または `host:port:user:pass`）。

## デプロイ

### Cloudflare Pages（推奨）

1. Pages でリポジトリを接続
2. Framework preset: `None` / Build output directory: `public`
3. 環境変数 `PROXY_KEY` を任意で設定（設定すると `?key=` 必須になる）
4. デプロイ

`public/_routes.json` が `/api/*` を Function に流す。これが無いと 404 になる。

### Netlify

`netlify.toml` のままでOK。`PROXY_KEY` を Site settings → Environment で設定可能。
同期 Function はタイムアウトが 10 秒（Pro で 26 秒）。重い処理は Cloudflare 推奨。

### Vercel

`api/proxy.js` が自動で Function になる。`bodyParser: false` を設定済み。

## 設定の目安

| 状況 | 同時実行 | 登録API最小間隔 | IP上限 | 429冷却 |
|---|---|---|---|---|
| プロキシ無し（自回線1本） | 1 | 30〜45 秒 | 1 | 300 秒 |
| プロキシ有り | 2〜3 | 15〜20 秒 | 2〜3 | 300 秒 |

429 は IP 単位で来る。`stickyIp` と `capUseProxy` は両方 ON が基本。
captcha をリクエストと違う IP で解くと UNSOLVABLE になる。

## 既知の限界

- 無料 HTTP プロキシは上流の `Host` 振り分けに非対応のものが混ざる。`api.ipify.org` 検証に通っても Discord が通らない個体は捨てる。
- Discord は `retry_after` で平気で 15 分〜1 時間返す。待つのが正解。
- メール認証（mail.tm）は Function 経由が必須（CORS）。