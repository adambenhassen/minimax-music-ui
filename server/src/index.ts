import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { JsonStore, Library } from './library.js';
import type { Template } from './types.js';
import { UpstreamClient } from './upstream.js';
import { Poller } from './poller.js';
import { createApp } from './app.js';

const config = loadConfig();
const tracksDir = path.join(config.dataDir, 'tracks');
const library = new Library(path.join(config.dataDir, 'library.json'));
await library.load();
const templates = new JsonStore<Template>(path.join(config.dataDir, 'templates.json'));
await templates.load();

const upstream = new UpstreamClient(config.musicApi, config.apiKey);
const poller = new Poller(library, upstream, tracksDir);

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultStatic = path.resolve(here, '../../web/dist');
const staticDir = config.staticDir ?? (fs.existsSync(defaultStatic) ? defaultStatic : null);

const app = createApp({ library, templates, upstream, poller, tracksDir, staticDir });
poller.start();

app.listen(config.port, () => {
  console.log(`minimax-music-ui server on http://localhost:${config.port}`);
  console.log(`  upstream: ${config.musicApi}${config.apiKey ? ' (bearer set)' : ''}`);
  console.log(`  data:     ${config.dataDir}`);
  console.log(`  static:   ${staticDir ?? '(none — run web dev server)'}`);
  const inflight = library.all().filter((t) => t.status === 'queued' || t.status === 'running').length;
  if (inflight) console.log(`  resuming ${inflight} in-flight track(s)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { poller.stop(); process.exit(0); });
}
