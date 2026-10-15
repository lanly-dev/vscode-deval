// Built-in benchmark for the LLM model wired to VS Code.
// `Deval: Benchmark Model` asks the user's selected LLM model every
// prompt in the built-in spec, records the responses, stages the built-in
// suite into the workspace, and runs it with the responses fed in.
import * as vscode from 'vscode';
import { readFile, unlink } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

import { ensureDeepEvalReady, devalDirectoryUri, executeTaskWithReporting } from './suites';
import { appendScore, summarizePassAtK, type SampleOutcome, type ScoreCheck } from './scores';
import { pickChatModel } from './chat-models';

/** Environment variable the staged suite reads the model responses from. */
export const MODEL_BENCHMARK_ENV = 'DEEPEVAL_MODEL_RESPONSES';

interface CodeVector {
	args: unknown[];
	expected: unknown;
}

interface BenchmarkCase {
	id: string;
	prompt: string;
	required: string[];
	forbidden?: string[];
	kind?: 'keyword' | 'code';
	function?: string;
	vectors?: CodeVector[];
}

interface ModelResponse {
	id: string;
	prompt: string;
	response: string;
	/** 1-based sample index: each prompt is asked SAMPLES_PER_PROMPT times. */
	sample: number;
	error?: string;
}

function isCodeVector(value: unknown): value is CodeVector {
	const candidate = value as Partial<CodeVector>;
	return Array.isArray(candidate?.args);
}

function isBenchmarkCase(value: unknown): value is BenchmarkCase {
	const candidate = value as Partial<BenchmarkCase>;
	if (
		typeof candidate?.id !== 'string' ||
		typeof candidate?.prompt !== 'string' ||
		!Array.isArray(candidate?.required) ||
		!candidate.required.every((keyword) => typeof keyword === 'string')
	) {
		return false;
	}
	if (candidate.kind === 'code') {
		return (
			typeof candidate.function === 'string' &&
			Array.isArray(candidate.vectors) &&
			candidate.vectors.length > 0 &&
			candidate.vectors.every(isCodeVector)
		);
	}
	return candidate.kind === undefined || candidate.kind === 'keyword';
}

async function loadSpec(extensionUri: vscode.Uri): Promise<BenchmarkCase[]> {
	const specUri = vscode.Uri.joinPath(extensionUri, 'resources', 'builtin-suites', 'spec.json');
	const raw = await vscode.workspace.fs.readFile(specUri);
	const parsed: unknown = JSON.parse(Buffer.from(raw).toString('utf8'));
	if (!Array.isArray(parsed) || !parsed.every(isBenchmarkCase)) {
		throw new Error('The built-in benchmark spec is malformed.');
	}
	return parsed;
}

async function askModel(
	model: vscode.LanguageModelChat,
	prompt: string,
	token: vscode.CancellationToken,
): Promise<string> {
	const answer = (async (): Promise<string> => {
		const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
		let text = '';
		for await (const part of response.text) {
			if (token.isCancellationRequested) {
				break;
			}
			text += part;
		}
		return text;
	})();
	// A stalled model stream would otherwise hang the whole benchmark (and no
	// score would ever be recorded). Time out instead; the caller records the
	// error against that case and moves on.
	return withTimeout(answer, MODEL_PROMPT_TIMEOUT_MS, 'LLM model response');
}

/**
 * One benchmark prompt may take this long before it counts as hung. These
 * are one-sentence prompts; anything slower is a stalled model, not a slow
 * one.
 */
const MODEL_PROMPT_TIMEOUT_MS = 180_000;

/**
 * Default samples collected per prompt when the `deval.samplesPerPrompt`
 * setting is absent. More than one sample lets the benchmark report pass@1
 * (typical single-try reliability) and pass@k (the model's capability
 * ceiling: solved in at least one of k tries), which a single sample can't
 * distinguish — a good model can flub once, a weak one can get lucky once.
 * Costs k times the model calls.
 */
const DEFAULT_SAMPLES_PER_PROMPT = 1;
/** Hard bounds for `deval.samplesPerPrompt`; VS Code enforces these too. */
const MIN_SAMPLES_PER_PROMPT = 1;
const MAX_SAMPLES_PER_PROMPT = 5;

/** Read `deval.samplesPerPrompt`, clamped to its valid range. */
function readSamplesPerPrompt(): number {
	const configured = vscode.workspace.getConfiguration('deval').get<unknown>('samplesPerPrompt');
	const value = typeof configured === 'number' && Number.isInteger(configured) ? configured : DEFAULT_SAMPLES_PER_PROMPT;
	return Math.min(MAX_SAMPLES_PER_PROMPT, Math.max(MIN_SAMPLES_PER_PROMPT, value));
}

/** Reject when `promise` takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	});
}

/**
 * Run the built-in model benchmark: query the wired LLM model, record its
 * answers, and score them with the suite that ships in `resources/`.
 */
export async function runModelBenchmark(context: vscode.ExtensionContext): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders?.length) {
		void vscode.window.showWarningMessage('Open a workspace folder to benchmark the LLM model.');
		return;
	}
	const workspaceFolder = folders[0];

	const model = await pickChatModel();
	if (!model) {
		return;
	}

	let spec: BenchmarkCase[];
	try {
		spec = await loadSpec(context.extensionUri);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Could not load the built-in benchmark: ${message}`);
		return;
	}

	const samplesPerPrompt = readSamplesPerPrompt();

	const responses = await vscode.window.withProgress<ModelResponse[] | undefined>(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Benchmarking ${model.name}`,
			cancellable: true,
		},
		async (progress, token) => {
			const collected: ModelResponse[] = [];
			const totalSteps = spec.length * samplesPerPrompt;
			for (const [index, testCase] of spec.entries()) {
				for (let sample = 1; sample <= samplesPerPrompt; sample++) {
					if (token.isCancellationRequested) {
						return undefined;
					}
					progress.report({
						message: `${index + 1}/${spec.length}: ${testCase.id} (sample ${sample}/${samplesPerPrompt})`,
						increment: 100 / totalSteps,
					});
					try {
						const response = await askModel(model, testCase.prompt, token);
						collected.push({ id: testCase.id, prompt: testCase.prompt, response, sample });
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						collected.push({ id: testCase.id, prompt: testCase.prompt, response: '', sample, error: message });
					}
				}
			}
			return collected;
		},
	);
	if (!responses) {
		return;
	}

	// The suite resolves `vitest` from the workspace, so stage the built-in
	// files there instead of running them from the extension's install
	// directory. Everything for one run lives in a single timestamped folder.
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const runDirectory = vscode.Uri.joinPath(workspaceFolder.uri, '.deval', 'model-benchmark', timestamp);
	const responsesUri = vscode.Uri.joinPath(runDirectory, 'responses.json');
	const stagedSuiteUri = vscode.Uri.joinPath(runDirectory, 'model-benchmark.test.ts');
	try {
		await vscode.workspace.fs.createDirectory(runDirectory);
		await vscode.workspace.fs.writeFile(
			responsesUri,
			Buffer.from(
				JSON.stringify({ model: model.name, created: timestamp, samplesPerPrompt, responses }, null, 2),
				'utf8',
			),
		);
		for (const name of ['model-benchmark.test.ts', 'spec.json']) {
			await vscode.workspace.fs.copy(
				vscode.Uri.joinPath(context.extensionUri, 'resources', 'builtin-suites', name),
				vscode.Uri.joinPath(runDirectory, name),
				{ overwrite: true },
			);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Could not stage the built-in benchmark: ${message}`);
		return;
	}

	const ready = await ensureDeepEvalReady(workspaceFolder, 'the built-in model benchmark');
	if (!ready) {
		return;
	}

	// The suite path is relative to wherever the runner executes: the
	// workspace root for a workspace install, `.deval/` for a `.deval/` install.
	const relativeSuitePath = relative(ready.cwd, stagedSuiteUri.fsPath).split(sep).join('/');
	const label = `Deval: Benchmark ${model.name}`;
	const task = new vscode.Task(
		{ type: 'deepeval', benchmark: 'model' },
		workspaceFolder,
		label,
		'Deval',
		new vscode.ProcessExecution(ready.command, ['deepeval', 'test', 'run', relativeSuitePath], {
			cwd: ready.cwd,
			env: { [MODEL_BENCHMARK_ENV]: responsesUri.fsPath },
		}),
	);
	task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated };
	// Delete any stale results file first, so the file we read afterwards can
	// only come from this run.
	const latestRunFile = join(ready.cwd, '.deepeval', '.latest_test_run.json');
	try {
		await unlink(latestRunFile);
	} catch {
		// Ignore: the file simply wasn't there.
	}
	await executeTaskWithReporting(task, label);
	// Record the score even when the benchmark failed: a failing run is still
	// a score worth comparing. When the run produced no results file at all,
	// say so — otherwise the missing scoreboard entry is a silent mystery.
	const recorded = await recordBenchmarkScore(workspaceFolder, latestRunFile, runDirectory, model.name, samplesPerPrompt);
	if (!recorded) {
		void vscode.window.showWarningMessage(
			`Deval: the benchmark finished without producing results, so no score was recorded. See the terminal for what happened.`,
		);
	}
}

/**
 * Read the DeepEval run's own results file and append one score record per
 * benchmark case. Resolves to true when a score was recorded; false when
 * there was no results file to read.
 */
async function recordBenchmarkScore(
	workspaceFolder: vscode.WorkspaceFolder,
	latestRunFile: string,
	runDirectory: vscode.Uri,
	modelName: string,
	samplesPerPrompt: number,
): Promise<boolean> {
	const checks = await readBenchmarkChecks(latestRunFile, vscode.Uri.joinPath(runDirectory, 'spec.json'), samplesPerPrompt);
	if (!checks) {
		return false;
	}
	void appendScore(devalDirectoryUri(workspaceFolder).fsPath, {
		timestamp: new Date().toISOString(),
		kind: 'model-benchmark',
		label: modelName,
		checks,
	});
	return true;
}

/** Parse DeepEval's `.latest_test_run.json` into one check per benchmark case. */
async function readBenchmarkChecks(
	latestRunFile: string,
	stagedSpecUri: vscode.Uri,
	samplesPerPrompt: number,
): Promise<ScoreCheck[] | undefined> {
	let latest: { cases?: Array<{ metricsData?: Array<{ name?: string; success?: boolean; score?: number; reason?: string }> }> };
	try {
		latest = JSON.parse(await readFile(latestRunFile, 'utf8'));
	} catch {
		return undefined;
	}
	const cases = Array.isArray(latest.cases) ? latest.cases : [];
	if (!cases.length) {
		return undefined;
	}
	// DeepEval's results file doesn't name the cases, so label them from the
	// staged spec, which lists them in run order. The suite emits
	// `samplesPerPrompt` consecutive results per spec case, so regroup them.
	let caseIds: string[] = [];
	try {
		const spec = JSON.parse(await readFile(stagedSpecUri.fsPath, 'utf8'));
		if (Array.isArray(spec)) {
			caseIds = spec.map((entry, index) =>
				typeof entry?.id === 'string' && entry.id ? entry.id : `case ${index + 1}`,
			);
		}
	} catch {
		// Fall back to positional labels below.
	}
	const sampleOutcome = (testCase: (typeof cases)[number]): SampleOutcome => {
		const metrics = Array.isArray(testCase.metricsData) ? testCase.metricsData : [];
		return {
			passed: metrics.length > 0 && metrics.every((metric) => metric.success !== false),
			detail: metrics.length
				? metrics
						.map(
							(metric) =>
								`${metric.name ?? 'metric'}: ${metric.success === false ? 'fail' : 'pass'}${
									typeof metric.score === 'number' ? ` (score ${metric.score})` : ''
								}`,
						)
						.join('; ')
				: 'no metrics reported',
		};
	};
	const checks: ScoreCheck[] = [];
	for (let offset = 0; offset < cases.length; offset += samplesPerPrompt) {
		const group = cases.slice(offset, offset + samplesPerPrompt);
		const groupIndex = Math.floor(offset / samplesPerPrompt);
		checks.push(
			summarizePassAtK(caseIds[groupIndex] ?? `case ${groupIndex + 1}`, group.map(sampleOutcome), samplesPerPrompt),
		);
	}
	return checks;
}
