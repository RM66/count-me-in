/**
 * Local OpenAPI preview — a dev-only Scalar page over the committed
 * public spec (apps/web/openapi.yaml).
 *
 * The API itself never serves documentation: FastAPI's spec/docs are
 * disabled (api/_lib/countmein/app.py) because the Zod-rendered
 * document is canonical, and nothing about this preview is deployed —
 * it is a browsing surface for developers, not a product route.
 *
 * The spec file is read per request, so `bun run generate:openapi`
 * output is live without restarting the preview.
 *
 * Run via: `bun run docs:api` (repo root or apps/web). Port override:
 * `DOCS_PORT=xxxx` (default 3002 — 3000/3001 are the dev servers).
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const specPath = join(__dirname, '..', 'openapi.yaml')
const port = Number(process.env.DOCS_PORT ?? 3002)

const page = `<!doctype html>
<html>
  <head>
    <title>CountMeIn API reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.yaml"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
`

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
    return
  }
  if (path === '/openapi.yaml') {
    try {
      const spec = await readFile(specPath)
      res.writeHead(200, { 'content-type': 'application/yaml; charset=utf-8' }).end(spec)
    } catch {
      res.writeHead(404).end('openapi.yaml is missing — run `bun run generate:openapi` first\n')
    }
    return
  }
  res.writeHead(404).end('not found\n')
})

server.listen(port, () => {
  console.log(`API docs (Scalar): http://localhost:${port}`)
})
