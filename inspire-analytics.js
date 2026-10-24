/* INSPIRE browser-game analytics. Configuration is supplied at deployment, never embedded in source. */
(function () {
  'use strict';
  var cfg = window.INSPIRE_ANALYTICS_CONFIG || {};
  var game = 'Emoji-Elements';
  var startedAt = null;
  var finished = false;
  var qs = new URLSearchParams(location.search);
  var source = qs.get('utm_source') || (document.referrer.indexOf('inspireclothing.art') !== -1 ? 'shopify' : 'direct');
  var placement = qs.get('utm_content') || qs.get('inspire_placement') || 'unknown';
  var campaign = qs.get('utm_campaign') || undefined;
  var allowedEvents = { game_opened: 1, game_started: 1, game_completed: 1, game_over: 1, error_encountered: 1 };
  var dedupe = Object.create(null);
  function capture(event, extra) {
    if (!allowedEvents[event]) return;
    try {
      var client = window.posthog;
      if (!client || typeof client.capture !== 'function' || !cfg.enabled) return;
      client.capture(event, Object.assign({ brand: 'INSPIRE', game: game, game_version: cfg.game_version || '2026-10-24', source: source, placement: placement, campaign: campaign, attribution_version: 'v1' }, extra || {}));
    } catch (_) { /* analytics must never disrupt the game */ }
  }
  function begin() {
    startedAt = Date.now();
    finished = false;
    capture('game_started');
  }
  function finish(outcome) {
    if (!startedAt || finished) return;
    finished = true;
    capture(outcome === 'won' ? 'game_completed' : 'game_over', { duration_seconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)), mode: 'arcane-duel' });
  }
  function report(kind, error) {
    var name = (error && error.name) || 'UnknownError';
    var key = kind + ':' + name;
    if (dedupe[key] && Date.now() - dedupe[key] < 30000) return;
    dedupe[key] = Date.now();
    capture('error_encountered', { error_type: kind, error_name: String(name).slice(0, 60) });
  }
  function attach() {
    if (typeof window.startGame === 'function' && !window.startGame.__inspireAnalytics) {
      var original = window.startGame;
      var wrapper = function () {
        var result = original.apply(this, arguments);
        begin();
        return result;
      };
      wrapper.__inspireAnalytics = true;
      window.startGame = wrapper;
    }
    var victory = document.getElementById('victoryOverlay');
    var defeat = document.getElementById('loseOverlay');
    if (typeof MutationObserver !== 'undefined') {
      [ [victory, 'won'], [defeat, 'lost'] ].forEach(function (pair) {
        if (!pair[0]) return;
        var node = pair[0], outcome = pair[1];
        var observer = new MutationObserver(function () {
          var style = window.getComputedStyle(node);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') finish(outcome);
        });
        observer.observe(node, { attributes: true, attributeFilter: ['class', 'style'] });
      });
    }
    capture('game_opened');
  }
  window.addEventListener('error', function (e) { report('uncaught_error', e.error); });
  window.addEventListener('unhandledrejection', function (e) { report('unhandled_rejection', e.reason); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, { once: true });
  else attach();
})();