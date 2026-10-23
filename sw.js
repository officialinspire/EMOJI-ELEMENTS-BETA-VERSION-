// Generated as sw.js by npm run pwa:build. One complete cache per app build.
const BUILD_ID = '7b570e9c5709';
const REQUIRED = {
  "index.html": "e511d7fb4200b8aba5c26ab48ac35d27e1d6277470cf4c2e98343b33943f6158",
  "index.js": "597c0fccfb2f9caa20144a41c3003b421e552e8510c0b18757d1503a2aa572f7",
  "styles.css": "53bcba93eeb0e3dded70008efe9cc28c91d79808ea79bdb209aaf79b3ec3029a",
  "feedback.js": "c7b392cec153a85b8493b3eecf0f3cda517cc2e1db6139915384e63bf81ef393",
  "achievements.js": "51c179c9e0f59a96c16a71aac13c72947542b40405e66bc65f07c957d1624cb4",
  "pwa.js": "9d98249f5c0ff1dae1836bd930e4eccd03bf3f501b7256c3f2025ee01715fdb0",
  "manifest.json": "2756814595e85f5a9c0f0ac6d7244286f476fb0f5ff9642b71b020412dd0b679",
  "icon.svg": "78a6f497c017d2abe7bd72ffa097ed1977c98a066033f9e9c0ba79f342ad13ce",
  "icon-192.png": "e8285876ce6c92d55f884daf15cdfd109a5585dae174a39430b537ba3b0fd952",
  "icon-512.png": "1f68d63954104f0475d3058ea5f65a7364bca6b684ca650cf7ed9499f8971683",
  "apple-touch-icon.png": "2f1bdf15a5ff45f5e5d23bfccd1b591f91a3522eac1885e8bac30b8599eacb2a",
  "menu-sigil.svg": "60d4c32dde59efd80f7f93ba4c8c61f0c42be9346573eaf8799b97d2748e1227",
  "menu-divider.svg": "0fdc776c71bd37f550afb52eb669bbfaf6c723cd4dd30e70ee35932d8b07c279",
  "audio/sfx/sfx-bank.wav": "e9eee3b46245c25654c7e0b5f3f76073c8e11b5fd90ff40777f2ff90b341d4f3",
  "pwa-build.js": "c0706fb7909ad55939c5361f0b8e2d68a4dcd12763f91fa94a4a6de40aa6aa2b"
};
const OPTIONAL = ['minimalist menu theme.mp3', 'Emoji Elements - Celestial Battle Theme.mp3', 'inspiresoftwareintro.mp4'];
const SCOPE = new URL('./', self.location).href;
const PREFIX = `emoji-elements@${SCOPE}:`;
const CACHE = `${PREFIX}${BUILD_ID}`;
const absolute = path => new URL(path, SCOPE).href;

async function download(path, expectedHash) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(absolute(path), { cache: 'reload', signal: controller.signal });
        if (response.status !== 200) throw new Error(`${path}: HTTP ${response.status}`);
        if (expectedHash) {
            const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
            const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            if (actual !== expectedHash) throw new Error(`${path}: incomplete deployment`);
        }
        await (await caches.open(CACHE)).put(absolute(path), response);
    } finally { clearTimeout(timeout); }
}
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const existed = await caches.has(CACHE);
        try {
            // Wait for every write before cleaning up a failed generation.
            const results = await Promise.allSettled(Object.entries(REQUIRED).map(([path, hash]) => download(path, hash)));
            const failed = results.find(result => result.status === 'rejected');
            if (failed) throw failed.reason;
            await Promise.allSettled(OPTIONAL.map(path => download(path)));
        } catch (error) {
            if (!existed) await caches.delete(CACHE);
            throw error;
        }
        // No automatic skipWaiting. A startup-button tap is required to replace an open version.
    })());
});
self.addEventListener('message', event => {
    if (event.data?.type !== 'EE_ACTIVATE_UPDATE') return;
    event.waitUntil((async () => {
        const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
            .filter(client => client.url.startsWith(SCOPE));
        if (clients.length > 1) {
            event.ports[0]?.postMessage({ ok: false });
            return;
        }
        event.ports[0]?.postMessage({ ok: true });
        await self.skipWaiting();
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        // Do not claim other tabs or delete a cache they might still be using.
        const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
            .filter(client => client.url.startsWith(SCOPE));
        if (clients.length <= 1) {
            const keys = await caches.keys();
            await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
        }
    })());
});

function rangeResponse(response, range) {
    return response.arrayBuffer().then(buffer => {
        const total = buffer.byteLength;
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        let start, end;
        if (match && (match[1] || match[2])) {
            start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
            end = match[1] ? (match[2] ? Number(match[2]) : total - 1) : total - 1;
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= total) {
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
        }
        end = Math.min(end, total - 1);
        return new Response(buffer.slice(start, end + 1), { status: 206, headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
            'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes'
        } });
    });
}
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.href.startsWith(SCOPE)) return;
    let path;
    try { path = decodeURIComponent(url.pathname.slice(new URL(SCOPE).pathname.length)); }
    catch (_) { return; } // malformed escapes are not app assets
    // Leave unrelated pages, sibling projects and all external requests alone.
    const file = path === '' ? 'index.html' : path;
    if (!(file in REQUIRED) && !OPTIONAL.includes(file)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(absolute(file));
        if (cached) return request.headers.has('range') ? rangeResponse(cached, request.headers.get('range')) : cached;
        const response = await fetch(request);
        if (response.status === 200 && OPTIONAL.includes(file) && !request.headers.has('range')) {
            await cache.put(absolute(file), response.clone()).catch(() => {});
        }
        return response;
    })());
});
