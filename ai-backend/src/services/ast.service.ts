/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ts from 'typescript';

export interface ICodeChunk {
	text: string;
	metadata: {
		id: string;
		uri: string;
		range: {
			startLineNumber: number;
			startColumn: number;
			endLineNumber: number;
			endColumn: number;
		};
		symbolName?: string;
		symbolType?: string;
		mtime?: number;
	};
}

export class AstService {
	static parseFile(uri: string, text: string, languageId: string, mtime: number = 0): ICodeChunk[] {
		if (!['ts', 'js', 'tsx', 'jsx'].includes(languageId)) {
			return this.fallbackChunking(uri, text, 50, mtime);
		}

		try {
			const sourceFile = ts.createSourceFile(uri, text, ts.ScriptTarget.Latest, true);
			const chunks: ICodeChunk[] = [];

			const walk = (node: ts.Node) => {
				if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || ts.isInterfaceDeclaration(node)) {
					const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
					const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

					let symbolName = 'anonymous';
					const namedNode = node as { name?: ts.Node };
					if (namedNode.name && ts.isIdentifier(namedNode.name)) {
						symbolName = namedNode.name.getText(sourceFile);
					}

					const range = {
						startLineNumber: start.line + 1,
						startColumn: start.character + 1,
						endLineNumber: end.line + 1,
						endColumn: end.character + 1
					};

					chunks.push({
						text: node.getText(sourceFile),
						metadata: {
							id: `${uri}#${range.startLineNumber}-${range.endLineNumber}`,
							uri,
							range,
							symbolName,
							symbolType: this.getKindString(node.kind),
							mtime
						}
					});
				}
				ts.forEachChild(node, walk);
			};

			walk(sourceFile);

			if (chunks.length === 0) {
				return this.fallbackChunking(uri, text, 50, mtime);
			}

			return chunks;
		} catch (err) {
			console.error(`[AST] Parsing failed for ${uri}:`, err);
			return this.fallbackChunking(uri, text);
		}
	}

	private static getKindString(kind: ts.SyntaxKind): string {
		switch (kind) {
			case ts.SyntaxKind.FunctionDeclaration: return 'function';
			case ts.SyntaxKind.ClassDeclaration: return 'class';
			case ts.SyntaxKind.MethodDeclaration: return 'method';
			case ts.SyntaxKind.InterfaceDeclaration: return 'interface';
			case ts.SyntaxKind.ModuleDeclaration: return 'module';
			default: return 'symbol';
		}
	}

	private static fallbackChunking(uri: string, text: string, chunkSize = 50, mtime = 0): ICodeChunk[] {
		const lines = text.split('\n');
		const lang = uri.split('.').pop()?.toLowerCase() || '';
		const chunks: ICodeChunk[] = [];

		// Professional Regex-based boundary detection for common languages
		const boundaryRegexes: Record<string, RegExp> = {
			python: /^(def\s+\w+|class\s+\w+)/,
			go: /^(func\s+\w+|type\s+\w+)/,
			java: /^(public|private|protected|class|interface|enum)\s+/,
			rust: /^(fn\s+\w+|struct\s+\w+|enum\s+\w+|impl\s+\w+)/,
			cpp: /^(class|struct|namespace|template)\s+/,
			c: /^(struct|enum|union|typedef)\s+/,
		};

		const regex = boundaryRegexes[lang];
		let currentChunkLines: string[] = [];
		let startLine = 1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const isBoundary = regex?.test(line.trim());

			if (isBoundary && currentChunkLines.length >= chunkSize / 2) {
				// Flush current chunk
				this.pushChunk(chunks, uri, currentChunkLines.join('\n'), startLine, i, mtime);
				currentChunkLines = [];
				startLine = i + 1;
			}

			currentChunkLines.push(line);

			if (currentChunkLines.length >= chunkSize * 1.5) {
				// Hard limit to avoid giant chunks
				this.pushChunk(chunks, uri, currentChunkLines.join('\n'), startLine, i + 1, mtime);
				currentChunkLines = [];
				startLine = i + 2;
			}
		}

		if (currentChunkLines.length > 0) {
			this.pushChunk(chunks, uri, currentChunkLines.join('\n'), startLine, lines.length, mtime);
		}

		return chunks;
	}

	private static pushChunk(chunks: ICodeChunk[], uri: string, text: string, startLine: number, endLine: number, mtime: number): void {
		chunks.push({
			text,
			metadata: {
				id: `${uri}#L${startLine}-${endLine}`,
				uri,
				range: {
					startLineNumber: startLine,
					startColumn: 1,
					endLineNumber: endLine,
					endColumn: 1 // Simplified
				},
				symbolName: '',
				symbolType: 'chunk',
				mtime
			}
		});
	}
}
