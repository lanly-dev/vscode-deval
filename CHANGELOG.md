# Change Log
All notable changes to the `deval` extension are documented here.\
Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.


## [Unreleased]
### Added
- `pass@k` scoring for the model benchmark (command 2): samples per prompt configurable via `deval.samplesPerPrompt` (1–5, default 1); per-case checks report pass@1 (mean single-sample success) and pass@k (solved in at least one sample).

### Planned
- Harder executable code cases for the benchmark suite.
- Scripted trajectory scenarios exercising command 1's checks against known-good/bad runs.
- Token usage tracking via the provider backend (input/output tokens per run).


## [0.0.1]
