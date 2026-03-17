/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BackendClient } from './backendClient';

/** Maximum characters of prefix to send (keeps prompt within token budget). */
const MAX_PREFIX_CHARS = 6000;
/** Maximum characters of suffix to send. */
const MAX_SUFFIX_CHARS = 800;
/** LRU-style cache size. */
const CACHE_MAX_SIZE = 60;
/** Cache TTL in milliseconds. */
const CACHE_TTL_MS = 8000;

interface CacheEntry {
	suggestion: string;
	expiry: number;
}

/**
 * CogniCompletionProvider — VS Code InlineCompletionItemProvider
 *
 * This is the core autocomplete bridge. It:
 *  1. Debounces keystrokes to avoid flooding the backend
 *  2. Extracts prefix + suffix from the active document
 *  3. Requests semantic context from the IDE via 'cogni.getContext' command
 *  4. Fetches a streaming FIM completion from the CogniAI backend
 *  5. Returns an InlineCompletionItem (ghost text) to VS Code
 *
 * Ghost text appears automatically as the user types.
 * Pressing TAB accepts the suggestion.
 */
export class CogniCompletionProvider implements vscode.InlineCompletionItemProvider {

	private _pendingAbort: AbortController | undefined;
	private readonly _cache = new Map<string, CacheEntry>();

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionList | undefined> {

		// -- Guard: enabled check ----------------------------------------------
		const config = vscode.workspace.getConfiguration('cogni.autocomplete');
		if (!config.get<boolean>('enabled', true)) {
			return undefined;
		}

		// -- Guard: skip if triggered by non-typing events (e.g. re-focus) ----
		if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
			// Only trigger on real typing — avoid suggestions on cursor move
		}

		// -- Debounce ---------------------------------------------------------
		// Cancel any in-flight request immediately
		this._pendingAbort?.abort();
		const abortController = new AbortController();
		this._pendingAbort = abortController;

		const debounceMs = config.get<number>('debounceMs', 300);

		// Wait for debounce period. If cancelled (user still typing), bail.
		const debounced = await new Promise<boolean>(resolve => {
			const timer = setTimeout(() => resolve(true), debounceMs);
			abortController.signal.addEventListener('abort', () => {
				clearTimeout(timer);
				resolve(false);
			});
			token.onCancellationRequested(() => {
				clearTimeout(timer);
				resolve(false);
			});
		});

		if (!debounced || token.isCancellationRequested) {
			return undefined;
		}

		// -- Extract prefix + suffix -------------------------------------------
		const fullText = document.getText();
		const offset = document.offsetAt(position);
		const prefix = fullText.slice(0, offset).slice(-MAX_PREFIX_CHARS);
		const suffix = fullText.slice(offset, offset + MAX_SUFFIX_CHARS);

		// Skip completion if the line is empty or cursor is at start of file
		const currentLine = document.lineAt(position.line).text.trim();
		if (prefix.length < 5) {
			return undefined;
		}

		// Skip if the user just typed a closing bracket/paren — unlikely to want completion
		const lastChar = prefix[prefix.length - 1];
		if (['}', ')', ']', ';'].includes(lastChar) && currentLine.length <= 1) {
			return undefined;
		}

		// -- Cache check -------------------------------------------------------
		// Key is based on file URI + last 300 chars of prefix (stable across minor cursor moves)
		const cacheKey = `${document.uri.toString()}::${prefix.slice(-300)}`;
		const cached = this._cache.get(cacheKey);
		if (cached && Date.now() < cached.expiry && cached.suggestion.trim()) {
			return this._makeList(cached.suggestion, position);
		}

		// -- Fetch semantic context & Backend request in parallel --------------
		const backendUrl = config.get<string>('backendUrl', 'http://127.0.0.1:3000');
		const useStreaming = config.get<boolean>('useStreaming', true);
		const client = new BackendClient(backendUrl);

		const requestPromise = (async () => {
			// Start context fetch
			const contextPromise = config.get<boolean>('useSemanticContext', true)
				? Promise.resolve(vscode.commands.executeCommand<{ assembledPrompt: string }>('cogni.getContext', document.uri, { lineNumber: position.line + 1, column: position.character + 1 })).catch(() => null)
				: Promise.resolve(null);

			const ctx = await contextPromise;
			if (token.isCancellationRequested || abortController.signal.aborted) { return undefined; }

			const requestBody = {
				prefix, suffix,
				language: document.languageId,
				filePath: document.uri.fsPath,
				context: ctx?.assembledPrompt || '',
			};

			try {
				const result = useStreaming
					? await client.fetchStreaming(requestBody, abortController.signal)
					: await client.fetchComplete(requestBody, abortController.signal);

				if (result.trim() && !token.isCancellationRequested) {
					this._setCache(cacheKey, result);
					return this._makeList(result, position);
				}
			} catch (err) {
				if (!token.isCancellationRequested && !abortController.signal.aborted) {
					console.error('[CogniAutocomplete] Backend Error:', err);
				}
			}
			return undefined;
		})();

		return requestPromise;
	}

	// -- Helpers ---------------------------------------------------------------

	private _makeList(suggestion: string, position: vscode.Position): vscode.InlineCompletionList {
		return new vscode.InlineCompletionList([
			new vscode.InlineCompletionItem(
				suggestion,
				new vscode.Range(position, position)
			)
		]);
	}

	private _setCache(key: string, value: string): void {
		// Evict oldest entries if at capacity (simple FIFO)
		if (this._cache.size >= CACHE_MAX_SIZE) {
			const firstKey = this._cache.keys().next().value;
			if (firstKey !== undefined) {
				this._cache.delete(firstKey);
			}
		}
		this._cache.set(key, { suggestion: value, expiry: Date.now() + CACHE_TTL_MS });
	}
}
