/**
 * Benchmark: scripted trajectory scenarios for the captured-run checks.
 *
 * `benchmarks/scenarios/` holds fabricated `.jsonl` captures — a known-good
 * run plus one run per failure mode — and a manifest (`scenarios.json`)
 * stating exactly which of the 11 trajectory checks each capture must pass
 * or fail. Every scenario is loaded with the same `loadCapturedRun` the
 * `Deval: Score Agent Run` command's suite uses and scored with the shared
 * `scoreCapturedTrajectory`, so the whole parse-and-score pipeline is under
 * test, not just the scorer over hand-built summaries (that is what
 * `src/test/score-trajectory.test.ts` covers).
 *
 * A scenario that drifts from its manifest fails here: either the capture
 * no longer exercises what it claims, or a check regressed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadCapturedRun } from '../src/events/event-log';
import { scoreCapturedTrajectory } from '../src/events/score-trajectory';

interface Scenario {
	file: string;
	description: string;
	/** Expected `passed` per check id; must name every check the scorer emits. */
	expect: Record<string, boolean>;
}

const scenarios = JSON.parse(
	readFileSync(fileURLToPath(new URL('./scenarios/scenarios.json', import.meta.url)), 'utf8'),
) as Scenario[];

describe('scripted trajectory scenarios', () => {
	it('the manifest covers at least one known-good and one known-bad run', () => {
		expect(scenarios.length).toBeGreaterThan(1);
		expect(scenarios.some((scenario) => Object.values(scenario.expect).every(Boolean))).toBe(true);
		expect(scenarios.some((scenario) => Object.values(scenario.expect).some((passed) => !passed))).toBe(true);
	});

	for (const scenario of scenarios) {
		it(scenario.description, () => {
			const capturePath = fileURLToPath(new URL(`./scenarios/${scenario.file}`, import.meta.url));
			const capture = loadCapturedRun(capturePath);
			const checks = scoreCapturedTrajectory({
				summary: capture.summary,
				skippedLines: capture.parsed.skippedLines,
			});

			// The manifest must speak about exactly the checks the scorer
			// emits — a renamed or added check invalidates every scenario.
			expect(Object.keys(scenario.expect).sort()).toEqual(checks.map((check) => check.id).sort());

			for (const check of checks) {
				expect(check.passed, `${scenario.file} · ${check.id}: ${check.detail}`).toBe(scenario.expect[check.id]);
			}
		});
	}
});
