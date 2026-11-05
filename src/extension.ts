// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { commands, ExtensionContext, Uri } from 'vscode';

import { registerDevalTools } from './agent/tools';
import { runModelBenchmark } from './model-benchmark';
import { runAgentCommand } from './run-agent-command';
import { showScoreboard } from './scoreboard-panel';
import { evaluateAgentRun } from './suites';

export function activate(context: ExtensionContext) {
	const rc = commands.registerCommand;

	const d1 = rc('deval.runAgent', () => runAgentCommand());
	const d2 = rc('deval.evaluateAgentRun', (captureUri?: Uri) => evaluateAgentRun(captureUri));
	const d3 = rc('deval.benchmarkChatModel', () => runModelBenchmark(context));
	const d4 = rc('deval.showScoreboard', () => showScoreboard());
	context.subscriptions.push(d1, d2, d3, d4, registerDevalTools());
}

export function deactivate() {}
