// Generated as sw.js by npm run pwa:build. One complete cache per app build.
const BUILD_ID = '__EE_BUILD__';
const REQUIRED = __EE_REQUIRED__;
const OPTIONAL = ['minimalist menu theme.mp3', 'Emoji Elements - Celestial Battle Theme.mp3',
    'Emoji Elements - Winning Battle Theme.mp3', 'Emoji Elements - Losing Battle Theme.mp3', 'inspiresoftwareintro.mp4'];
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
