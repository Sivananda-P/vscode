/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IAIService } from './ai.js';

export class AIChannel implements IServerChannel {

	constructor(private readonly service: IAIService) { }

	listen(context: any, event: string): Event<any> {
		throw new Error('Invalid listen');
	}

	call(context: any, command: string, args?: any, token: CancellationToken = CancellationToken.None): Promise<any> {
		switch (command) {
			case 'request': return this.service.request(args[0], args[1], token);
		}

		throw new Error('Invalid call');
	}
}

export class AIChannelClient implements IAIService {

	declare readonly _serviceBrand: undefined;

	constructor(private readonly channel: IChannel) { }

	async request(url: string, data: any, token: CancellationToken): Promise<any> {
		return this.channel.call('request', [url, data], token);
	}
}
