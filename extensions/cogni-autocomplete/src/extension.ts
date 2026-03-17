/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CogniCompletionProvider } from './completionProvider';

let provider: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext): void {
	console.log('[CogniAutocomplete] Extension activating...');

	// Register or dispose the provider based on config
	const registerProvider = () => {
		const enabled = vscode.workspace.getConfiguration('cogni.autocomplete').get<boolean>('enabled', true);

		if (enabled) {
			if (!provider) {
				const completionProvider = new CogniCompletionProvider();
				provider = vscode.languages.registerInlineCompletionItemProvider(
					{ pattern: '**' }, // All file types
					completionProvider
				);
				context.subscriptions.push(provider);
				console.log('[CogniAutocomplete] Inline completion provider registered.');
			}
		} else {
			if (provider) {
				provider.dispose();
				provider = undefined;
				console.log('[CogniAutocomplete] Inline completion provider unregistered.');
			}
		}
	};

	// Initial registration
	registerProvider();

	// Re-register when config changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('cogni.autocomplete.enabled')) {
				registerProvider();
			}
		})
	);

	// Toggle command
	context.subscriptions.push(
		vscode.commands.registerCommand('cogni.autocomplete.toggle', () => {
			const config = vscode.workspace.getConfiguration('cogni.autocomplete');
			const current = config.get<boolean>('enabled', true);
			config.update('enabled', !current, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(
				`CogniAI Autocomplete ${!current ? 'enabled OK' : 'disabled (off)'}`
			);
		})
	);

	// Manual trigger command — explicitly ask VS Code to show inline suggestions
	context.subscriptions.push(
		vscode.commands.registerCommand('cogni.autocomplete.triggerManually', () => {
			vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
		})
	);

	console.log('[CogniAutocomplete] Extension activated.');
}

export function deactivate(): void {
	provider?.dispose();
	provider = undefined;
	console.log('[CogniAutocomplete] Extension deactivated.');
}
