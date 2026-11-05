// The `Deval: Run Agent` command: ask for a prompt, run the Deval agent on
// it, and offer to score the captured run right away.
//
// This is the agent's entry point since the `@deval` chat participant was
// removed: chat participants are deprecated and only work in Local-harness
// sessions, while a command works in every session type.
import * as vscode from 'vscode';

import { runDevalAgent } from './agent/run-agent';
import { DEFAULT_EVAL_PROMPT } from './suites';

/** Run the Deval agent from the Command Palette and offer to score the run. */
export async function runAgentCommand(): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders?.length) {
		void vscode.window.showWarningMessage('Open a workspace folder to run the Deval agent.');
		return;
	}

	const prompt = await vscode.window.showInputBox({
		prompt: 'What should the Deval agent do? Its run will be captured and can be scored.',
		value: DEFAULT_EVAL_PROMPT,
	});
	if (!prompt) {
		return;
	}

	const captureUri = await runDevalAgent(folders[0], prompt);
	if (!captureUri) {
		return;
	}

	const scoreNow = 'Score This Run';
	const choice = await vscode.window.showInformationMessage(
		'Deval agent run captured.',
		scoreNow,
	);
	if (choice === scoreNow) {
		await vscode.commands.executeCommand('deval.evaluateAgentRun', captureUri);
	}
}
