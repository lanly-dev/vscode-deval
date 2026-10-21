# Change Log
All notable changes to the `deval` extension are documented here.\
Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.


## [Unreleased]
### Added
- `pass@k` scoring for the model benchmark (command 2): samples per prompt configurable via `deval.samplesPerPrompt` (1–5, default 1); per-case checks report pass@1 (mean single-sample success) and pass@k (solved in at least one sample).
- Four harder executable code cases for the benchmark suite (now 9 code + 6 keyword = 15 cases): merge-intervals, valid-parentheses, coin-change (greedy fails the `[1,3,4] → 6` vector), and group-anagrams with canonical output ordering.
- Scripted trajectory scenarios for command 1's checks: 12 fabricated captures in `benchmarks/scenarios/` (known-good, one per failure mode, empty) with per-check expectations in `scenarios.json`, run end to end through the capture parser and scorer by `benchmarks/trajectory-scenarios.test.ts`.

### Fixed
- The capture parser dropped the Stop event's `final_text`, so every completed run scored from a file wrongly failed the substantive-answer check. Found by the new good-run scenario.

## [0.0.1]
