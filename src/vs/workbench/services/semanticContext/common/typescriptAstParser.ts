/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeChunk } from './semanticIndexer.js';
import { URI } from '../../../../base/common/uri.js';

export interface IAstParser {
	parse(uri: URI, model: any): ICodeChunk[];
}

/**
 * Professional Phase 8: This file is now DISABLED in the renderer to prevent browser crashes.
 * The AST parsing logic has been moved to the backend (ai-backend/src/index.ts).
 */
export class TypescriptAstParser implements IAstParser {
	parse(uri: URI, model: any): ICodeChunk[] {
		// No-op in renderer. Real parsing happens on the server.
		return [];
	}
}
