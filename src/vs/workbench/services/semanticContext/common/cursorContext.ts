/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IOutlineModelService } from '../../../../editor/contrib/documentSymbols/browser/outlineModel.js';
import { ICursorContext, IPosition, IRange, ISymbolInfo } from './semanticContext.js';
import { ILogService } from '../../../../platform/log/common/log.js';

const SURROUNDING_LINES = 20;

/**
 * Extracts structured local context around the cursor:
 * - Current function/method/class symbol
 * - ±20 surrounding lines
 * - All import statements in the file
 *
 * Professional Phase 8: This service is now 100% renderer-safe (no typescript module import).
 */
export class CursorContextExtractor {
	constructor(
		@ITextModelService private readonly textModelService: ITextModelService,
		@IOutlineModelService private readonly outlineModelService: IOutlineModelService,
		@ILogService private readonly logService: ILogService
	) { }

	async extract(uri: URI, position: IPosition, token: CancellationToken): Promise<ICursorContext> {
		this.logService.trace(`CursorContext: extracting at ${uri.toString()}:${position.lineNumber}`);

		const modelRef = await this.textModelService.createModelReference(uri);
		try {
			const model = modelRef.object.textEditorModel;
			const lineCount = model.getLineCount();

			// ── Surrounding lines ────────────────────────────────────────────
			const startLine = Math.max(1, position.lineNumber - SURROUNDING_LINES);
			const endLine = Math.min(lineCount, position.lineNumber + SURROUNDING_LINES);
			const surroundingLines = model.getValueInRange({
				startLineNumber: startLine,
				startColumn: 1,
				endLineNumber: endLine,
				endColumn: model.getLineMaxColumn(endLine)
			});

			// ── Import statements ────────────────────────────────────────────
			const importStatements = this.extractImports(model, lineCount);

			// ── Position-based symbol extraction ──────────────────────────────────
			let currentSymbol: ISymbolInfo | undefined;
			let enclosingSymbol: ISymbolInfo | undefined;

			try {
				// Professional Phase 8: Use Outline Symbols for all languages (safe for browser)
				const outline = await this.outlineModelService.getOrCreate(model, token);
				const allSymbols = outline.getTopLevelSymbols();
				const hierarchy = this.findSymbolHierarchy(allSymbols, position.lineNumber);

				if (hierarchy.length >= 1) {
					currentSymbol = this.toSymbolInfo(hierarchy[hierarchy.length - 1], model);
				}
				if (hierarchy.length >= 2) {
					enclosingSymbol = this.toSymbolInfo(hierarchy[hierarchy.length - 2], model);
				}
			} catch (err) {
				this.logService.trace(`CursorContext: could not get outline: ${err}`);
			}

			return { uri, currentSymbol, enclosingSymbol, surroundingLines, importStatements };
		} finally {
			modelRef.dispose();
		}
	}

	/** Walk symbol tree and return the path from root to the deepest symbol containing the line. */
	private findSymbolHierarchy(symbols: any[], lineNumber: number, depth = 0): any[] {
		for (const sym of symbols) {
			const r = sym.range as IRange;
			if (r.startLineNumber <= lineNumber && lineNumber <= r.endLineNumber) {
				if (sym.children?.length) {
					const child = this.findSymbolHierarchy(sym.children, lineNumber, depth + 1);
					if (child.length > 0) return [sym, ...child];
				}
				return [sym];
			}
		}
		return [];
	}

	private toSymbolInfo(sym: any, model: any): ISymbolInfo {
		const range: IRange = {
			startLineNumber: sym.range.startLineNumber,
			startColumn: sym.range.startColumn,
			endLineNumber: sym.range.endLineNumber,
			endColumn: sym.range.endColumn
		};
		return {
			name: sym.name,
			kind: sym.kind?.toString() ?? 'symbol',
			range,
			text: model.getValueInRange(range)
		};
	}

	private extractImports(model: any, lineCount: number): string[] {
		const imports: string[] = [];

		// Professional Phase 8: Use Regex scanner for imports in the renderer.
		// Fast, efficient, and doesn't require a heavy AST parser for TS.
		const scanTo = Math.min(100, lineCount); // Scan more lines for imports
		for (let i = 1; i <= scanTo; i++) {
			const line = model.getLineContent(i) as string;
			if (/^\s*(import|export\s+.*\s+from|const\s+\w+\s*=\s*require)\b/.test(line)) {
				imports.push(line.trim());
			}
		}
		return imports;
	}
}
