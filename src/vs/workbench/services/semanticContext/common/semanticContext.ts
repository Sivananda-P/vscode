/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';

export const ISemanticContextService = createDecorator<ISemanticContextService>('semanticContextService');

export type SemanticIndexStatus = 'unindexed' | 'idle' | 'building' | 'ready' | 'updating' | 'error';

export interface IIndexProgress {
	total: number;
	processed: number;
}

export interface ISemanticContextService {
	readonly _serviceBrand: undefined;

	/** Fires whenever the indexing status changes. */
	readonly onDidChangeStatus: Event<SemanticIndexStatus>;

	/** Fires during bulk indexing with progress updates. */
	readonly onDidIndexProgress: Event<IIndexProgress>;

	/** Current indexing status. */
	readonly status: SemanticIndexStatus;

	/** Full workspace indexing. */
	indexWorkspace(token: CancellationToken): Promise<void>;

	/** Basic vector similarity search. */
	search(query: string, token: CancellationToken): Promise<ISemanticSearchResult[]>;

	/** Full Cursor-style layered context for AI features. */
	getLayeredContext(uri: URI, position: IPosition, prompt: string, token: CancellationToken, onProgress?: (result: ILayeredContext) => void): Promise<ILayeredContext>;

	/** Legacy helper — returns assembled prompt string directly. */
	getContext(uri: URI, position: IPosition, token: CancellationToken): Promise<string>;

	/** Whether the backend is reachable. */
	readonly isAvailable: boolean;
}

export interface IPosition {
	lineNumber: number;
	column: number;
}

export interface ISemanticSearchResult {
	uri: URI;
	range: IRange;
	text: string;
	score: number;
	symbolName?: string;
	symbolType?: string;
	dependencyScore?: number;
	recencyScore?: number;
}

export interface IRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

// ─── Cursor Context ────────────────────────────────────────────────────────────

export interface ICursorContext {
	/** The innermost function/method at the cursor, if any. */
	currentSymbol: ISymbolInfo | undefined;
	/** The enclosing class/module, if any. */
	enclosingSymbol: ISymbolInfo | undefined;
	/** ±N lines around the cursor. */
	surroundingLines: string;
	/** All import statements in the file. */
	importStatements: string[];
	/** The file URI. */
	uri: URI;
}

export interface ISymbolInfo {
	name: string;
	kind: string;
	range: IRange;
	text: string;
}

// ─── Layered Context ─────────────────────────────────────────────────────────

export interface ILayeredContext {
	/** Immediate code context around the cursor. */
	cursorContext: ICursorContext;
	/** Top-K semantically similar chunks. */
	semanticMatches: ISemanticSearchResult[];
	/** Chunks pulled in via dependency graph expansion. */
	dependencyContext: ISemanticSearchResult[];
	/** Related file paths (imports, callers). */
	relatedFiles: URI[];
	/** The final assembled prompt ready for LLM consumption. */
	assembledPrompt: string;
	/** Estimated token count of assembledPrompt. */
	tokenEstimate: number;
	/** Whether this is a partial result (semantic matches only) or the full results. */
	isFinal: boolean;
}
