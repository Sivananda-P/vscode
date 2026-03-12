/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExpression } from '../../../../base/common/glob.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export const DEFAULT_CODE_FILE_PATTERNS: IExpression = {
	'**/*.{ts,js,py,java,go,cpp,c,cs,rs,tsx,jsx}': true
};

export const DEFAULT_EXCLUDE_PATTERNS: IExpression = {
	'**/node_modules/**': true,
	'**/.venv*/**': true,
	'**/venv/**': true,
	'**/env/**': true,
	'**/.env/**': true,
	'**/__pycache__/**': true,
	'**/.cache/**': true,
	'**/.pytest_cache/**': true,
	'**/.mypy_cache/**': true,
	'**/build/**': true,
	'**/dist/**': true,
	'**/.git/**': true
};

/**
 * Builds the comprehensive exclude pattern object by layered merging:
 * 1. Default excludes (internal constants)
 * 2. User-defined excludes from workspace settings (files.exclude and search.exclude)
 *
 * Note: .gitignore patterns are handled natively by the ISearchService via the
 * disregardIgnoreFiles flag, so they don't need to be manually appended here.
 */
export function buildExcludePatterns(configurationService: IConfigurationService): IExpression {
	const merged: IExpression = { ...DEFAULT_EXCLUDE_PATTERNS };

	// Read files.exclude from settings
	const filesExclude = configurationService.getValue<IExpression>('files.exclude');
	if (filesExclude) {
		Object.assign(merged, filesExclude);
	}

	// Read search.exclude from settings
	const searchExclude = configurationService.getValue<IExpression>('search.exclude');
	if (searchExclude) {
		Object.assign(merged, searchExclude);
	}

	return merged;
}
