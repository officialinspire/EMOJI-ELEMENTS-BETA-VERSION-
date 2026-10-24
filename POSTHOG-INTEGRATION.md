# INSPIRE PostHog integration — Emoji Elements

Status: **feature branch; not activated in production**.

The `inspire-analytics.js` adapter tracks:
- `game_opened` once the page is initialized
- `game_started` when `startGame()` succeeds
- `game_completed` on victory and `game_over` on defeat
- `error_encountered` for sanitized uncaught exceptions and rejected Promises (deduplicated by type/name over 30 seconds)

All events contain `brand`, `game=Emoji-Elements`, `game_version`, `source`, `placement`, and `campaign`. It never transmits card state, save data, raw exception messages, URLs, personal information, or a user identity. Errors and missing PostHog do not interrupt gameplay.

## Deployment
1. Inject `window.INSPIRE_ANALYTICS_CONFIG = { enabled: true, game_version: '<release>' }` from deployment configuration **before** the analytics adapter runs.
2. Initialize the shared PostHog browser SDK using **deployment environment configuration**, not a key committed to source; disable automatic pageviews, autocapture, session replay, and person profiles per INSPIRE's privacy policy. Verify GDPR/consent handling and cross-site cookie behavior.
3. Test the adapter against the existing custom events from other games; verify that victory and defeat overlays produce **one** end event each.
4. Test autoplay, PWA, offline, sound, restart, saved game, and win/lose flows on desktop/mobile. Validate and revise `startGame` hook if initialization timing differs.
5. Join Shopify to GitHub Pages with UTM links, for example `?utm_source=shopify&utm_medium=website&utm_campaign=inspire_arcade&utm_content=home_hero_emoji_elements`. The `utm_content` value becomes `placement`.
6. After verifying QA, merge this PR and deploy. A recorded `game_opened` with `source=shopify` confirms cross-site game launch attribution. For **click-to-launch conversion**, Shopify must separately send `game_link_clicked` on button tap and carry the same campaign/placement values to the game; without shared anonymous identities, report matching UTM campaign totals rather than a person-level funnel.

Do not claim full funnel linkage from this script alone.
