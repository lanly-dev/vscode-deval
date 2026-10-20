# Change Log
All notable changes to the `deval` extension are documented here.\
Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.


## [Unreleased]
### Added
- `pass@k` scoring for the model benchmark (command 2): samples per prompt configurable via `deval.samplesPerPrompt` (1–5, default 1); per-case checks report pass@1 (mean single-sample success) and pass@k (solved in at least one sample).
- Four harder executable code cases for the benchmark suite (now 9 code + 6 keyword = 15 cases): merge-intervals, valid-parentheses, coin-change (greedy fails the `[1,3,4] → 6` vector), and group-anagrams with canonical output ordering.

### Planned
- Scripted trajectory scenarios exercising command 1's checks against known-good/bad runs.


## [0.0.1]
