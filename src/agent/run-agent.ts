// The Deval agent runner: drives the dependency-free agent loop over the
// Language Model API and the read-only workspace tools, capturing every run.
//
// This used to be reachable through the `@deval` chat participant, but chat
// participants are deprecated and only work in Local-harness sessions, so
// runs now start from the `Deval: Run Agent` command instead. The loop, the
// tools, and the capture format are unchanged — only the entry point moved.
import * as vscode from 'vscode';

import { createCaptureWriter } from '../events/event-writer';
import { pickChatModel } from '../chat-models';
import { runAgentLoop, type EventPort } from './loop';
import { DEVAL_TOOL_SCHEMAS } from './tool-schemas';
import { createVscodeModelPort, createVscodeToolPort } from './vscode-adapter';

/** System instruction for the Deval agent loop. */
export const DEVAL_AGENT_SYSTEM_PROMPT =
	'You are Deval, a helpful coding assistant inside VS Code. ' +
	'You have read-only tools to inspect the workspace: read files, list directories, and search file contents. ' +
	'Use them to ground your answers in the actual workspace instead of guessing. ' +
	'Call a tool whenever you need information you do not already have, then answer concisely.';

/**
 * Run the Deval agent on `prompt`: pick an LLM model, run the loop with a
 * cancellable progress notification, and capture the run to
 * `.deval/vscode-agent-events/<session-id>.jsonl`, so `Deval: Score Agent
 * Run` can score the agent's trajectory without any extra wiring.
 *
 * Resolves to the capture file's `vscode.Uri` once the run completes, or
 * `undefined` when the user cancelled, picked no model, or the loop failed.
 */
export async function runDevalAgent(
	workspaceFolder: vscode.WorkspaceFolder,
	prompt: string,
): Promise<vscode.Uri | undefined> {
	const model = await pickChatModel();
	if (!model) {
		return undefined;
	}

	const writer = createCaptureWriter(workspaceFolder.uri.fsPath);
	writer.append({ hook_event_name: 'SessionStart', model: model.name });
	const events: EventPort = {
		record: (event) => writer.append(event),
	};

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Deval agent is working…',
			cancellable: true,
		},
		async (_progress, token) => {
			const modelPort = createVscodeModelPort(model, token, () => {});
			const toolPort = createVscodeToolPort(token, undefined);
			try {
				await runAgentLoop(
					prompt,
					{ model: modelPort, tools: toolPort, events },
					{ toolSchemas: DEVAL_TOOL_SCHEMAS, systemPrompt: DEVAL_AGENT_SYSTEM_PROMPT },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				void vscode.window.showErrorMessage(`The agent loop failed: ${message}`);
				return undefined;
			}
			return vscode.Uri.file(writer.filePath);
		},
	);
}
