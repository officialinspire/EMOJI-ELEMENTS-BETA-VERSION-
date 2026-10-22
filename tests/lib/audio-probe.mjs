// Independent, primitive-only accounting: never retains AudioNodes or changes their scheduling.
export function installAudioProbe() {
    const ids = new WeakMap();
    const rows = [];
    let cue = 0;
    window.__audioProbe = {
        begin() { return ++cue; },
        snapshot() {
            const live = rows.filter(r => r.source && r.started && !r.ended && r.connected);
            return { created: rows.length, sources: rows.filter(r => r.source).length,
                liveSources: live.length, liveCues: new Set(live.map(r => r.cue)).size,
                connected: rows.filter(r => r.connected).length,
                stopped: rows.filter(r => r.stopped).length, ended: rows.filter(r => r.ended).length };
        }
    };
    for (const name of ['createOscillator', 'createBufferSource', 'createGain', 'createBiquadFilter', 'createDynamicsCompressor']) {
        const original = BaseAudioContext.prototype[name];
        BaseAudioContext.prototype[name] = function (...args) {
            const node = original.apply(this, args);
            const row = { cue, source: /Oscillator|BufferSource/.test(name), connected: false };
            ids.set(node, row); rows.push(row);
            if (row.source) {
                for (const method of ['start', 'stop']) {
                    const call = node[method].bind(node);
                    node[method] = (...values) => { const result = call(...values); row[method === 'start' ? 'started' : 'stopped'] = true; return result; };
                }
                node.addEventListener('ended', () => { row.ended = true; }, { once: true });
            }
            return node;
        };
    }
    for (const method of ['connect', 'disconnect']) {
        const original = AudioNode.prototype[method];
        AudioNode.prototype[method] = function (...args) {
            const result = original.apply(this, args);
            const row = ids.get(this);
            if (row) row.connected = method === 'connect';
            return result;
        };
    }
}
