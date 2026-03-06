/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { SemanticIndexer } from '../../common/semanticIndexer.js';
import { IOutlineModelService } from '../../../../../editor/contrib/documentSymbols/browser/outlineModel.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('SemanticIndexer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let indexer: SemanticIndexer;

	setup(() => {
		const outlineModelService = new (mock<IOutlineModelService>())();
		const textModelService = new (mock<ITextModelService>())();
		const logService = new (mock<ILogService>())();

		indexer = new SemanticIndexer(outlineModelService, textModelService, logService);
	});

	test('fallbackChunking breaks 120-line file into 3 chunks', () => {
		const model = {
			getLineCount: () => 120,
			getLineMaxColumn: (_line: number) => 10,
			getValueInRange: (_range: unknown) => 'some code'
		} as any;

		const chunks = (indexer as any).fallbackChunking(model);
		assert.strictEqual(chunks.length, 3);
		assert.strictEqual(chunks[0].range.startLineNumber, 1);
		assert.strictEqual(chunks[0].range.endLineNumber, 50);
		assert.strictEqual(chunks[1].range.startLineNumber, 51);
		assert.strictEqual(chunks[1].range.endLineNumber, 100);
		assert.strictEqual(chunks[2].range.startLineNumber, 101);
		assert.strictEqual(chunks[2].range.endLineNumber, 120);
	});

	test('fallbackChunking handles small files as a single chunk', () => {
		const model = {
			getLineCount: () => 10,
			getLineMaxColumn: (_line: number) => 5,
			getValueInRange: (_range: unknown) => 'x'
		} as any;

		const chunks = (indexer as any).fallbackChunking(model);
		assert.strictEqual(chunks.length, 1);
		assert.strictEqual(chunks[0].range.startLineNumber, 1);
		assert.strictEqual(chunks[0].range.endLineNumber, 10);
	});

	test('fallbackChunking handles exact chunk-size boundary', () => {
		const model = {
			getLineCount: () => 50,
			getLineMaxColumn: (_line: number) => 3,
			getValueInRange: (_range: unknown) => 'abc'
		} as any;

		const chunks = (indexer as any).fallbackChunking(model);
		assert.strictEqual(chunks.length, 1);
	});
});
