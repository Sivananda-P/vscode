import * as ts from 'typescript';

export interface ICodeChunk {
	text: string;
	metadata: {
		uri: string;
		range: {
			startLineNumber: number;
			startColumn: number;
			endLineNumber: number;
			endColumn: number;
		};
		symbolName?: string;
		symbolType?: string;
	};
}

export class AstService {
	static parseFile(uri: string, text: string, languageId: string): ICodeChunk[] {
		if (!['ts', 'js', 'tsx', 'jsx'].includes(languageId)) {
			return this.fallbackChunking(uri, text);
		}

		try {
			const sourceFile = ts.createSourceFile(uri, text, ts.ScriptTarget.Latest, true);
			const chunks: ICodeChunk[] = [];

			const walk = (node: ts.Node) => {
				if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || ts.isInterfaceDeclaration(node)) {
					const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
					const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

					let symbolName = 'anonymous';
					if ((node as any).name) {
						symbolName = (node as any).name.getText(sourceFile);
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
							uri,
							range,
							symbolName,
							symbolType: this.getKindString(node.kind)
						}
					});
				}
				ts.forEachChild(node, walk);
			};

			walk(sourceFile);

			if (chunks.length === 0) {
				return this.fallbackChunking(uri, text);
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

	private static fallbackChunking(uri: string, text: string, chunkSize = 50): ICodeChunk[] {
		const lines = text.split('\n');
		const chunks: ICodeChunk[] = [];
		for (let i = 0; i < lines.length; i += chunkSize) {
			const chunkText = lines.slice(i, i + chunkSize).join('\n');
			chunks.push({
				text: chunkText,
				metadata: {
					uri,
					range: {
						startLineNumber: i + 1,
						startColumn: 1,
						endLineNumber: Math.min(i + chunkSize, lines.length),
						endColumn: lines[Math.min(i + chunkSize, lines.length) - 1]?.length || 1
					}
				}
			});
		}
		return chunks;
	}
}
