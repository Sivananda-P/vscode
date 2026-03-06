/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IOutlineModelService } from '../../../../editor/contrib/documentSymbols/browser/outlineModel.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ISymbolInfo, IRange } from './semanticContext.js';

// ─── Enhanced Chunk Metadata ─────────────────────────────────────────────────

export interface ICodeChunk {
	/** Unique ID — `uri::startLine:endLine`. */
	id: string;
	uri: URI;
	/** The file path as a string (convenient for serialization). */
	filePath: string;
	range: IRange;
	text: string;
	/** Symbol name if extracted from AST, e.g. "MyClass.doSomething". */
	symbolName?: string;
	/** Symbol kind, e.g. "function", "class", "method", "interface". */
	symbolType?: string;
}

function makeChunkId(uri: URI, startLine: number, endLine: number): string {
	return `${uri.toString()}::${startLine}:${endLine}`;
}

// ─── SemanticIndexer ────────────────────────────────────────────────────────

export class SemanticIndexer {
	constructor(
		@IOutlineModelService private readonly outlineModelService: IOutlineModelService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ILogService private readonly logService: ILogService
	) { }

	async indexFile(uri: URI, token: CancellationToken): Promise<ICodeChunk[]> {
		this.logService.trace(`SemanticIndexer: indexing ${uri.toString()}`);

		const modelRef = await this.textModelService.createModelReference(uri);
		try {
			const model = modelRef.object.textEditorModel;
			const outline = await this.outlineModelService.getOrCreate(model, token);
			const symbols = outline.getTopLevelSymbols();

			if (symbols.length === 0) {
				return this.fallbackChunking(model);
			}

			return this.chunksFromSymbols(uri, model, symbols);
		} finally {
			modelRef.dispose();
		}
	}

	/** Recursively flatten document symbols into chunks, preserving name/kind. */
	private chunksFromSymbols(uri: URI, model: ITextModel, symbols: any[], parentName?: string): ICodeChunk[] {
		const chunks: ICodeChunk[] = [];
		for (const sym of symbols) {
			const symbolName = parentName ? `${parentName}.${sym.name}` : sym.name;
			const symbolType = this.kindToString(sym.kind);
			const range: IRange = {
				startLineNumber: sym.range.startLineNumber,
				startColumn: sym.range.startColumn,
				endLineNumber: sym.range.endLineNumber,
				endColumn: sym.range.endColumn
			};
			chunks.push({
				id: makeChunkId(uri, range.startLineNumber, range.endLineNumber),
				uri,
				filePath: uri.fsPath,
				range,
				text: model.getValueInRange(range),
				symbolName,
				symbolType
			});
			// Recurse for methods/nested classes
			if (sym.children && sym.children.length > 0) {
				chunks.push(...this.chunksFromSymbols(uri, model, sym.children, symbolName));
			}
		}
		return chunks;
	}

	private kindToString(kind: number): string {
		// SymbolKind from lsp protocol
		const kinds: Record<number, string> = {
			1: 'file', 2: 'module', 3: 'namespace', 4: 'package',
			5: 'class', 6: 'method', 7: 'property', 8: 'field',
			9: 'constructor', 10: 'enum', 11: 'interface', 12: 'function',
			13: 'variable', 14: 'constant', 15: 'string', 16: 'number',
			22: 'struct', 23: 'event', 24: 'operator'
		};
		return kinds[kind] ?? 'symbol';
	}

	fallbackChunking(model: ITextModel, chunkSize = 75, overlap = 10): ICodeChunk[] {
		const chunks: ICodeChunk[] = [];
		const lineCount = model.getLineCount();
		const step = chunkSize - overlap;

		for (let i = 1; i <= lineCount; i += step) {
			const endLine = Math.min(i + chunkSize - 1, lineCount);
			const range: IRange = {
				startLineNumber: i,
				startColumn: 1,
				endLineNumber: endLine,
				endColumn: model.getLineMaxColumn(endLine)
			};
			chunks.push({
				id: makeChunkId(model.uri, i, endLine),
				uri: model.uri,
				filePath: model.uri.fsPath,
				range,
				text: model.getValueInRange(range)
			});
			if (endLine === lineCount) break;
		}
		return chunks;
	}

	/** Extract structured symbol info from a position (used by CursorContext). */
	async getSymbolAtPosition(uri: URI, lineNumber: number, column: number, token: CancellationToken): Promise<ISymbolInfo | undefined> {
		const modelRef = await this.textModelService.createModelReference(uri);
		try {
			const model = modelRef.object.textEditorModel;
			const outline = await this.outlineModelService.getOrCreate(model, token);
			const symbols = outline.getTopLevelSymbols();
			return this.findSymbolAtLine(symbols, lineNumber);
		} finally {
			modelRef.dispose();
		}
	}

	private findSymbolAtLine(symbols: any[], lineNumber: number): ISymbolInfo | undefined {
		for (const sym of symbols) {
			const r = sym.range as IRange;
			if (r.startLineNumber <= lineNumber && lineNumber <= r.endLineNumber) {
				// Prefer deepest match (child over parent)
				if (sym.children) {
					const child = this.findSymbolAtLine(sym.children, lineNumber);
					if (child) return child;
				}
				return {
					name: sym.name,
					kind: this.kindToString(sym.kind),
					range: r,
					text: sym.name
				};
			}
		}
		return undefined;
	}
}
