# Change Log
All notable changes to the `deval` extension are documented here.\
Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.


## [Unreleased]
### Added
- `Deval: Run Agent` command: runs the Deval agent on a prompt you type (LLM model picker, cancellable progress) and offers to score the captured run immediately. This replaces the `@deval` chat participant as the agent's entry point.
- `pass@k` scoring for the model benchmark (command 2): samples per prompt configurable via `deval.samplesPerPrompt` (1–5, default 1); per-case checks report pass@1 (mean single-sample success) and pass@k (solved in at least one sample).
- Four harder executable code cases for the benchmark suite (now 9 code + 6 keyword = 15 cases): merge-intervals, valid-parentheses, coin-change (greedy fails the `[1,3,4] → 6` vector), and group-anagrams with canonical output ordering.
- Scripted trajectory scenarios for command 1's checks: 12 fabricated captures in `benchmarks/scenarios/` (known-good, one per failure mode, empty) with per-check expectations in `scenarios.json`, run end to end through the capture parser and scorer by `benchmarks/trajectory-scenarios.test.ts`.

### Fixed
- The capture parser dropped the Stop event's `final_text`, so every completed run scored from a file wrongly failed the substantive-answer check. Found by the new good-run scenario.

### Removed
- The `@deval` chat participant. Chat participants are deprecated and only work in Local-harness chat sessions, so depending on one made the agent unreachable in the default Copilot harness. The agent loop, tools, and capture format are unchanged; runs now start from `Deval: Run Agent`.

## [0.0.1]
