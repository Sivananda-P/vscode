/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICursorContext, ISemanticSearchResult } from './semanticContext.js';
import { IRankedResult } from './contextRanker.js';

/**
 * Rough tokens-per-char estimate (GPT4 averages ~4 chars/token).
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export interface IAssembledPrompt {
	/** Full prompt text ready to send to LLM. */
	text: string;
	/** Estimated token count. */
	tokenEstimate: number;
	/** Number of context chunks included. */
	chunksIncluded: number;
}

/**
 * Combines all retrieval layers into a structured LLM prompt.
 *
 * Section order:
 *   [System Instructions]
 *   [Cursor Context — current symbol + imports]
 *   [Top Semantic Matches]
 *   [Dependency Graph Context]
 *   [User Prompt]
 *
 * Respects a token budget, trimming lower-priority sections first.
 */
export class PromptAssembler {
	private readonly TOKEN_BUDGET = 8000;

	assemble(
		userPrompt: string,
		cursorContext: ICursorContext,
		rankedResults: IRankedResult[],
		dependencyContext: ISemanticSearchResult[],
		systemInstructions?: string
	): IAssembledPrompt {
		const sections: string[] = [];
		let tokensSoFar = 0;

		// ── System Instructions ──────────────────────────────────────────────
		const sysInstructions = systemInstructions ??
			'You are an expert software engineer assistant with access to the project codebase. ' +
			'Use the provided code context to give accurate, idiomatic answers.';

		sections.push(`## System\n${sysInstructions}`);
		tokensSoFar += estimateTokens(sysInstructions);

		// ── Cursor Context ───────────────────────────────────────────────────
		const cursorLines: string[] = [];

		if (cursorContext.currentSymbol) {
			const sym = cursorContext.currentSymbol;
			cursorLines.push(`**Current symbol:** \`${sym.name}\` (${sym.kind})`);
		}
		if (cursorContext.enclosingSymbol) {
			cursorLines.push(`**Inside:** \`${cursorContext.enclosingSymbol.name}\``);
		}
		if (cursorContext.importStatements.length > 0) {
			cursorLines.push('**Imports:**\n```typescript\n' + cursorContext.importStatements.slice(0, 10).join('\n') + '\n```');
		}
		cursorLines.push('**Surrounding code:**\n```\n' + this.trim(cursorContext.surroundingLines, 60) + '\n```');

		const cursorSection = `## Cursor Context\n${cursorLines.join('\n\n')}`;
		tokensSoFar += estimateTokens(cursorSection);
		sections.push(cursorSection);

		// ── Semantic Matches ─────────────────────────────────────────────────
		const semanticLines: string[] = [];
		for (const result of rankedResults) {
			const header = `### ${result.symbolName ?? result.uri.fsPath} (score: ${result.finalScore.toFixed(2)})`;
			const body = '```\n' + this.trim(result.text, 40) + '\n```';
			const snippet = `${header}\n${body}`;
			const cost = estimateTokens(snippet);
			if (tokensSoFar + cost > this.TOKEN_BUDGET * 0.75) break;
			semanticLines.push(snippet);
			tokensSoFar += cost;
		}
		if (semanticLines.length > 0) {
			sections.push(`## Relevant Code\n${semanticLines.join('\n\n')}`);
		}

		// ── Dependency Context ───────────────────────────────────────────────
		const depLines: string[] = [];
		for (const dep of dependencyContext) {
			if (tokensSoFar >= this.TOKEN_BUDGET * 0.875) break;
			const snippet = `- \`${dep.symbolName ?? dep.uri.fsPath}\` (${dep.symbolType ?? 'symbol'})`;
			depLines.push(snippet);
			tokensSoFar += estimateTokens(snippet);
		}
		if (depLines.length > 0) {
			sections.push(`## Related Symbols\n${depLines.join('\n')}`);
		}

		// ── User Prompt ──────────────────────────────────────────────────────
		sections.push(`## Task\n${userPrompt}`);
		tokensSoFar += estimateTokens(userPrompt);

		const text = sections.join('\n\n---\n\n');
		return {
			text,
			tokenEstimate: estimateTokens(text), // re-estimate on final joined string
			chunksIncluded: semanticLines.length
		};
	}

	/** Trim a string to at most N lines. */
	private trim(text: string, maxLines: number): string {
		const lines = text.split('\n');
		if (lines.length <= maxLines) return text;
		return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
	}
}
