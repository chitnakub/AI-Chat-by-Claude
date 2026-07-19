import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  AIRS_GW_API_KEY,
  AIRS_GW_BASE_URL = 'http://your-airs-gw/v1',
  DEFAULT_AIRS_GW_CONFIG = '',
  DEFAULT_MODEL = 'gemini-2.0-flash',
  ALLOWED_GATEWAY_HOSTS = '',
  PORT = 3000,
} = process.env;

if (!AIRS_GW_API_KEY) {
  console.error('\n[fatal] AIRS_GW_API_KEY is not set. Copy .env.example to .env and fill it in.\n');
  process.exit(1);
}

// Optional allowlist of hostnames a client may point the gateway URL at.
// The server default host is always allowed. Empty = allow any http(s) host.
const allowedHosts = new Set(
  ALLOWED_GATEWAY_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
);
try {
  allowedHosts.add(new URL(AIRS_GW_BASE_URL).hostname.toLowerCase());
} catch {
  console.error(`\n[fatal] AIRS_GW_BASE_URL is not a valid URL: ${AIRS_GW_BASE_URL}\n`);
  process.exit(1);
}
const restrictHosts = ALLOWED_GATEWAY_HOSTS.trim().length > 0;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Expose only non-secret defaults to the UI so the fields can pre-populate.
app.get('/api/defaults', (_req, res) => {
  res.json({
    defaultModel: DEFAULT_MODEL,
    defaultConfig: DEFAULT_AIRS_GW_CONFIG,
    baseUrl: AIRS_GW_BASE_URL,
  });
});

/**
 * Chat proxy. The browser never sees the AIRS-GW API key.
 * Body: { messages, model?, config?, metadata? }
 *  - metadata is a plain object, e.g. {"_user":"NOTE","app":"AI-Chat","env":"GCP-Dev"}
 *  - config is an AIRS-GW config slug (string) OR an inline config object.
 * Streams the AIRS-GW/OpenAI-compatible SSE response straight through.
 */
app.post('/api/chat', async (req, res) => {
  const { messages, model, config, metadata, baseUrl } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] is required' });
  }

  // Resolve the gateway URL: per-request override falls back to the server default.
  // Only http(s) URLs are accepted so the API key can't be sent to an odd scheme.
  let effectiveBaseUrl = AIRS_GW_BASE_URL;
  if (typeof baseUrl === 'string' && baseUrl.trim()) {
    let parsed;
    try {
      parsed = new URL(baseUrl.trim());
    } catch {
      return res.status(400).json({ error: `Invalid baseUrl: ${baseUrl}` });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'baseUrl must be an http(s) URL' });
    }
    if (restrictHosts && !allowedHosts.has(parsed.hostname.toLowerCase())) {
      return res.status(400).json({
        error: `Gateway host not allowed: ${parsed.hostname}`,
        allowed: [...allowedHosts],
      });
    }
    // Strip any trailing slash so we can safely append the path.
    effectiveBaseUrl = parsed.toString().replace(/\/+$/, '');
  }

  // Build AIRS-GW headers.
  const headers = {
    'Content-Type': 'application/json',
    'x-portkey-api-key': AIRS_GW_API_KEY,
  };

  const effectiveConfig = config ?? DEFAULT_AIRS_GW_CONFIG;
  if (effectiveConfig) {
    // A slug goes through as-is; an object is JSON-encoded.
    headers['x-portkey-config'] =
      typeof effectiveConfig === 'string' ? effectiveConfig : JSON.stringify(effectiveConfig);
  }

  if (metadata && Object.keys(metadata).length > 0) {
    headers['x-portkey-metadata'] = JSON.stringify(metadata);
  }

  const body = JSON.stringify({
    model: model || DEFAULT_MODEL,
    messages,
    stream: true,
  });

  try {
    const upstream = await fetch(`${effectiveBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body,
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      console.error(`[airs-gw ${upstream.status}]`, text);
      return res
        .status(upstream.status || 502)
        .json({ error: `AIRS-GW error ${upstream.status}`, detail: text });
    }

    // Pass the SSE stream through to the browser unchanged.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    // Abort the upstream request if the client disconnects.
    req.on('close', () => reader.cancel().catch(() => {}));

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    console.error('[proxy error]', err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Upstream request failed', detail: String(err) });
    } else {
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`\n  AIRS-GW Chat UI running at  http://localhost:${PORT}`);
  console.log(`  Gateway: ${AIRS_GW_BASE_URL}`);
  console.log(`  Default model: ${DEFAULT_MODEL}\n`);
});
