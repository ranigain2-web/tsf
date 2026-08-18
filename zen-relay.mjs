#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// OpenCode Zen local relay
// ════════════════════════════════════════════════════════════════
// Hugging Face Spaces only allows outbound HTTP/HTTPS on ports 80/443/8080,
// so `https://opencode.ai/zen` is reachable. The relay runs on 127.0.0.1 and
// proxies OpenAI-compatible requests to Zen while applying the two things
// Zen's FREE models require:
//
//   1. User-Agent must match the official OpenCode CLI, otherwise Tier-1 free
//      models (deepseek-v4-flash-free, mimo-v2.5-free, big-pickle, ...)
//      return HTTP 429 (FreeUsageLimitError).
//   2. The Authorization header must be ABSENT. Any non-empty value
//      (even "Bearer placeholder") is rejected with HTTP 401.
//
// OpenClaw registers this as a local custom provider, so no API key is ever
// required and no probe traffic is generated.
// ════════════════════════════════════════════════════════════════
import http from "node:http";
import { Readable } from "node:stream";

const TARGET = process.env.ZEN_TARGET || "https://opencode.ai/zen";
const UA = process.env.ZEN_USER_AGENT || "opencode/1.18.18 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14";
const PORT = Number(process.env.ZEN_RELAY_PORT || 11435);
const HOST = process.env.ZEN_RELAY_HOST || "127.0.0.1";

const server = http.createServer(async (req, res) => {
  // Minimal health endpoint for debugging / supervision.
  if (req.method === "GET" && (req.url === "/__health" || req.url === "/__health/")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok\n");
    return;
  }

  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("bad url\n");
    return;
  }

  const target = TARGET + url.pathname + url.search;
  const headers = { ...req.headers };
  delete headers["authorization"];
  delete headers["host"];
  delete headers["content-length"];
  headers["user-agent"] = UA;
  headers["accept-encoding"] = "identity";

  // Buffer the (small) JSON body. OpenAI-compatible requests are tiny.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
    });
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: String(err && err.message ? err.message : err) } }));
    return;
  }

  const respHeaders = {};
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "content-length" || lower === "transfer-encoding" || lower === "connection") continue;
    respHeaders[key] = value;
  }

  res.writeHead(upstream.status, respHeaders);
  if (upstream.body) {
    Readable.fromWeb(upstream.body).pipe(res);
  } else {
    res.end();
  }
});

server.on("error", (err) => {
  console.error(`[zen-relay] error: ${err && err.message ? err.message : err}`);
});

server.listen(PORT, HOST, () => {
  console.error(`[zen-relay] listening on http://${HOST}:${PORT} -> ${TARGET}`);
});
