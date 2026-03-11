/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IAIService } from '../common/ai.js';
import { IRequestService, asText } from '../../request/common/request.js';

export class AIMainService extends Disposable implements IAIService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IRequestService private readonly requestService: IRequestService
	) {
		super();
	}

	async request(url: string, data: any, token: CancellationToken): Promise<any> {
		const response = await this.requestService.request({
			url,
			type: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			data: JSON.stringify(data)
		}, token);

		const result = await asText(response);
		if (response.res.statusCode !== 200) {
			throw new Error(`AI Backend error (${response.res.statusCode}): ${result}`);
		}

		return JSON.parse(result!);
	}
}
