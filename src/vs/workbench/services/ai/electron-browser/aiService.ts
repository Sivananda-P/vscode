/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAIService } from '../../../../platform/ai/common/ai.js';
import { AIChannelClient } from '../../../../platform/ai/common/aiIpc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

export class NativeAIService implements IAIService {
	declare readonly _serviceBrand: undefined;

	private readonly client: IAIService;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		this.client = new AIChannelClient(mainProcessService.getChannel('ai'));
	}

	request(url: string, data: any, token: CancellationToken): Promise<any> {
		return this.client.request(url, data, token);
	}
}

registerSingleton(IAIService, NativeAIService, InstantiationType.Delayed);
