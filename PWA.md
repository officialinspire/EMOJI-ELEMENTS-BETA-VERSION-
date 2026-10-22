# Installed app, offline play and startup updates

The initialization screen shows the current build, **Check for updates**, and an accessible status line.
An installed update changes the button to **Reload updated version**. Only that explicit startup tap
activates it and reloads this page once. Starting the game is never blocked by downloading an update.
An offline/failed check leaves the current app playable. Updating never clears localStorage, IndexedDB,
achievements, preferences, or another INSPIRE game's caches.

`sw.js` caches one complete app shell per build. Required assets are verified against SHA-256 hashes;
missing or mismatched files reject the new install and preserve the previous generation. Music/video
are optional and can retry later. Cached media supports byte-range requests. External fonts use the
existing system fallbacks offline. The first successful online install is required before offline use.

Workers and cache names are scoped to this GitHub Pages project path. Updates wait rather than taking
over a match. Applying an update first checks for other app windows; if any are open, the status asks
you to close them before retrying. It never forces another tab's match to update. Activation does not
claim clients. Old caches are removed only during activation when no other app tab is present.
Closing all tabs lets the browser activate a waiting update too.

## When publishing a change

1. Run `npm run pwa:build` after changing app files or media.
2. Commit **both generated files**, `sw.js` and `pwa-build.js`, with those changes.
3. Run `npm run pwa:check` and `npm run pwa`. CI checks the generated build and discovers the browser test
   in the existing logic verification group.
4. Publish all files together. A partially uploaded deployment will be rejected by hash verification;
   users can retry after the upload finishes.

The generator hashes the app shell, media and worker template. Changing only an asset still creates a
new worker/build; CI rejects a forgotten regeneration. Edit `scripts/sw-template.js`, not generated sw.js.

`?qa=1` disables offline caching so ordinary fixture tests do not install workers. The PWA suite exercises
the actual production path with real workers, two deployments, offline navigation and preserved saves.

Device checks after deployment: install/open on Android and iOS, check an update on the initialization
screen, reopen offline, and confirm progress remains. Headless browser tests are not an OS installation test.
