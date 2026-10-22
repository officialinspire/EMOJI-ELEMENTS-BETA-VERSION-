// Startup-only updates. Never clear player storage or reload an active match.
(() => {
    'use strict';
    const panel = document.getElementById('pwaUpdate');
    const button = document.getElementById('pwaUpdateButton');
    const status = document.getElementById('pwaUpdateStatus');
    const version = document.getElementById('pwaVersion');
    if (!panel || !button || !status) return;
    version.textContent = `Build ${window.EE_BUILD_ID || 'development'}`;
    let registration;
    let busy = false;
    let applying = false;
    let reloaded = false;
    const atStartup = () => {
        const start = document.getElementById('clickToStart');
        return start && getComputedStyle(start).display !== 'none'
            && getComputedStyle(start).pointerEvents !== 'none';
    };
    const show = (message) => { status.textContent = message; };
    const refreshButton = () => {
        button.textContent = registration?.waiting ? 'Reload updated version' : 'Check for updates';
        button.disabled = busy;
    };
    // A tap here must not bubble into the existing tap-anywhere-to-start handlers.
    for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown', 'keyup']) {
        panel.addEventListener(type, event => event.stopPropagation());
    }
    const startScreen = document.getElementById('clickToStart');
    for (const type of ['pointerup', 'touchend', 'click']) {
        startScreen?.addEventListener(type, event => {
            if (applying && !panel.contains(event.target)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);
    }
    if (new URLSearchParams(location.search).has('qa') && !new URLSearchParams(location.search).has('pwa')) {
        button.disabled = true;
        show('Offline caching is disabled in QA mode.');
        return;
    }
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
        button.disabled = true;
        show('Updates require HTTPS or localhost. You can still play.');
        return;
    }
    const waitForWorker = (worker, target) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error('Update took too long. Please try again.')), 25000);
        function finish(error) {
            clearTimeout(timeout);
            worker.removeEventListener('statechange', inspect);
            error ? reject(error) : resolve();
        }
        function inspect() {
            if (worker.state === target || (target === 'installed' && worker.state === 'activated')) finish();
            else if (worker.state === 'redundant') finish(new Error('Update download failed. Your current version is safe.'));
        }
        worker.addEventListener('statechange', inspect);
        inspect();
    });
    const requestActivation = worker => new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
            channel.port1.close();
            reject(new Error('Update did not respond. Please try again.'));
        }, 5000);
        channel.port1.onmessage = event => {
            clearTimeout(timeout);
            channel.port1.close();
            if (event.data?.ok) resolve();
            else reject(new Error('Close other Emoji Elements tabs or app windows, then try again.'));
        };
        worker.postMessage({ type: 'EE_ACTIVATE_UPDATE' }, [channel.port2]);
    });
    const ready = navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
        .then(async reg => {
            registration = reg;
            reg.addEventListener('updatefound', () => {
                const worker = reg.installing;
                if (!worker) return;
                if (!busy) show('Downloading app files… You can still start playing.');
                waitForWorker(worker, 'installed').then(() => {
                    if (!busy) show(reg.waiting ? 'Update ready. Reload when you are ready.' : 'App saved for offline play.');
                    refreshButton();
                }).catch(error => { if (!busy) show(error.message); });
            });
            if (reg.waiting) show('Update ready. Reload when you are ready.');
            else if (reg.installing) {
                show('Preparing offline play… You can still start playing.');
                const worker = reg.installing;
                waitForWorker(worker, 'installed').then(() => {
                    if (!busy) show(reg.waiting ? 'Update ready. Reload when you are ready.' : 'App saved for offline play.');
                    refreshButton();
                }).catch(error => { if (!busy) show(error.message); });
            } else show(navigator.onLine ? 'Ready. Check for updates before you play.' : 'Offline. Playing your saved app version.');
            refreshButton();
            return reg;
        }).catch(() => {
            show('Offline or update service unavailable. You can still play.');
            refreshButton();
            return null;
        });
    button.addEventListener('click', async () => {
        if (busy || !atStartup()) return;
        busy = true;
        refreshButton();
        try {
            const reg = await ready;
            if (!reg) throw new Error('Update service unavailable. Reopen online to try again.');
            if (reg.waiting) {
                applying = true;
                show('Applying update…');
                const worker = reg.waiting;
                await requestActivation(worker);
                await waitForWorker(worker, 'activated');
                // Other tabs retain their old controller; this tab reloads once, only at startup.
                if (atStartup() && !reloaded) {
                    reloaded = true;
                    window.location.reload();
                }
                return;
            }
            if (!navigator.onLine) throw new Error('Offline. Connect to check for updates; you can still play.');
            show('Checking for updates…');
            await reg.update();
            if (reg.installing) await waitForWorker(reg.installing, 'installed');
            show(reg.waiting ? 'Update ready. Tap Reload updated version to apply it.' : 'You are up to date.');
        } catch (error) {
            show(navigator.onLine ? error.message : 'Offline. Your saved app and progress are still available.');
        } finally {
            applying = false;
            busy = false;
            refreshButton();
        }
    });
})();
