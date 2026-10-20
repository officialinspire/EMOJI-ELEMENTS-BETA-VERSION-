# QA Report — superseded

This report has been replaced by **[QA_BASELINE.md](QA_BASELINE.md)**, which records the verified rules, flows,
save keys, prioritized defects and the repeatable browser smoke suite (`node tests/smoke.mjs`).

Two claims in the previous version of this file no longer hold:
- **Browser automation does not crash.** Playwright 1.56.1 with Chromium 141 launches and runs the full
  desktop and mobile suites. The earlier SIGSEGV could not be reproduced.
- **Not every feature works.** The win → OPEN BOOSTER step is unclickable (D1), and the Deck Builder cannot
  save decks (D2).
