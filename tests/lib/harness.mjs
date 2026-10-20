// Shared helpers for the browser test suites: locate Playwright and serve the repo root.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadPlaywright() {
    const require = createRequire(import.meta.url);
    try {
        return require('playwright');
    } catch (_) {
        // Fall back to a globally installed copy (npm i -g playwright).
        const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
        return require(path.join(globalRoot, 'playwright'));
    }
}

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
};

export function startServer() {
    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
        if (!filePath.startsWith(ROOT)) {
            res.writeHead(403);
            return res.end();
        }
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
