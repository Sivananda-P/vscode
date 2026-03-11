/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAIService = createDecorator<IAIService>('aiService');

export interface IAIService {
	readonly _serviceBrand: undefined;

	request(url: string, data: any, token: CancellationToken): Promise<any>;
}
