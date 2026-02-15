# QA Report — Current Build Health

## Build Health Snapshot
- **Overall status:** ⚠️ **Yellow (functional but verification incomplete in this environment).**
- **Code-level health:** JavaScript loads extensive QA instrumentation (`QA_MODE = true`) and exposes QA helper hooks for smoke and regression checks.
- **Execution caveat:** Browser automation in this container crashes during Playwright launch (Chromium headless SIGSEGV), so cross-browser runtime verification is currently blocked here.

---

## Feature Checklist

| Area | Status | Notes |
|---|---|---|
| Menus (main/how-to/stats/navigation) | ✅ Implemented | Menu routing and nav smoke helper exist (`__qaNavSmoke`). |
| Gameplay loop (start match, turns, combat, win/loss) | ✅ Implemented | Core gameplay + match finalization paths are present, with win/loss credit handling and pack-award hooks. |
| Deck builder | ✅ Implemented | Deck validation/save path exists, plus `__qaDeckBuilderSmoke` helper. |
| Binder / Collection | ✅ Implemented | Binder/collection IDs and navigation hooks are conditionally checked in QA pathways. |
| Packs | ✅ Implemented | Pack purchase + pack reveal pipeline exists with metadata persistence. |
| Shop | ✅ Implemented | Pack shop UI and credit badge updates are wired (`shopCreditsBadge`, pack costs, purchase path). |
| Credits economy | ✅ Implemented | Starter credits + earn-on-match + spend-on-pack flow implemented through meta wallet. |
| Pack opening swipe | ✅ Implemented | Pointer/touch drag-to-rip and reveal-card swipe handlers are implemented. |

> **Interpretation:** checklist items are implemented in the codebase; runtime pass/fail per browser remains pending due container browser-launch limitations.

---

## Desktop Test Matrix

| Platform | Result | Notes |
|---|---|---|
| Chrome (Desktop) | ⚠️ Blocked in container | Attempted Playwright Chromium run; browser process crashed with SIGSEGV before tests executed. |
| Firefox (Desktop) | ⚠️ Not reached | Same automation run aborted at Chromium launch step before Firefox phase could complete. |

---

## Mobile Test Matrix

| Platform | Result | Notes |
|---|---|---|
| Android Chrome | ⚠️ Pending manual/device validation | Mobile emulation test plan prepared but not executable after browser runtime crash. |
| Samsung Internet | ⚠️ Pending manual/device validation | Requires Android device/browser validation; emulation run blocked by container browser crash. |

---

## Known Issues (Current)

### 1) Browser automation instability in this environment
- **Severity:** Medium (QA infrastructure issue, not gameplay logic change).
- **Repro steps:**
  1. Start local server (`python3 -m http.server 8000`).
  2. Run Playwright browser automation (Chromium launch).
  3. Observe immediate browser process crash (`SIGSEGV`) and test abort.
- **Impact:** Prevents automated cross-browser verification in CI/container session.
- **Workaround:** Run manual QA on local desktop/mobile browsers or use a runner image with stable Playwright browser binaries.

### 2) Pack purchase QA helper can intentionally fail when credits are insufficient
- **Severity:** Low (expected guardrail behavior that may appear as failure in naive smoke scripts).
- **Repro steps:**
  1. Reset meta or use low-credit profile.
  2. Run `__qaBuyPack('fantasy')`.
  3. If credits are below cost, purchase returns insufficient-credits path and no pack opens.
- **Impact:** Smoke scripts should seed credits or assert the expected `insufficient_credits` branch.

---

## Performance Notes

### Optimizations already present
- **UI update batching:** Uses a scheduled `requestAnimationFrame` pipeline (`scheduleUIUpdate` → `performUIUpdate`) to coalesce redraw pressure.
- **Resize debouncing:** Canvas resize handler debounced at 100ms to reduce resize thrash.
- **Audio throttling:** SFX queue enforces minimum interval for duplicate sounds, reducing rapid replay churn.
- **QA perf probe:** `__qaPerfBurst` + DOM-pressure warnings (`qaWarnDomPressure`) help detect lingering overlays/floating elements.

### Remaining hotspots / watch items
- **Full hand/board re-rendering per UI update:** `performUIUpdate` rebuilds large DOM sections (`innerHTML = ''` then re-create card nodes), which can become costly late-game.
- **Frequent timer usage for VFX/SFX:** Multiple `setTimeout` bursts for damage/heal effects can stack under heavy combat turns.
- **Overlay/modal layering pressure:** QA perf checks indicate this is an area to monitor (`[QA PERF] overlay pressure` warnings).

---

## QA Helpers (Runtime)

### Global helpers
- `__qaDumpMeta()` — prints concise meta summary (credits, W/L, packs opened, selected deck, collection size).
- `__qaResetMeta()` — clears persisted meta storage and reloads.
- `__qaNavSmoke()` — menu/navigation smoke checks across menu/how-to/deck/binder/shop/back flows.
- `__qaBuyPack(themeKey)` — purchase-pack smoke helper with assertions for `lastPack` and collection growth.
- `__qaDeckBuilderSmoke(deckKey)` — deck-builder validation smoke checks (ownership, copy limits, size/rules).
- `__qaPerfBurst()` — synthetic burst test for frame timing and transient DOM-pressure diagnostics.

### Internal QA utilities (non-global but relevant)
- `qaAssertDomIds(ids)`
- `qaWarnDomPressure(context)`

---

## Suggested Next QA Pass (when browser runtime is stable)
1. Run `__qaNavSmoke()` on desktop Chrome/Firefox and mobile Android Chrome/Samsung Internet.
2. Execute a full match (win + loss) and verify credits/stat updates.
3. Validate pack flow end-to-end: buy pack → rip-open gesture → swipe reveal cards.
4. Run `__qaDeckBuilderSmoke()` for at least 2 deck keys (mono + dual identity).
5. Run `__qaPerfBurst()` before and after a long match state to compare frame timing drift.
