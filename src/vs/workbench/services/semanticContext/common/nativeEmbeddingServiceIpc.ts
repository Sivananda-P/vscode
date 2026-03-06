/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Event } from '../../../../base/common/event.js';
import { INativeEmbeddingService } from './nativeEmbeddingService.js';

export class NativeEmbeddingChannel implements IServerChannel {

	constructor(private service: INativeEmbeddingService) { }

	listen(_: unknown, event: string): Event<any> {
		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, args?: any): Promise<any> {
		switch (command) {
			case 'provideEmbeddings': return this.service.provideEmbeddings(args[0], args[1]);
		}

		throw new Error(`Call not found: ${command}`);
	}
}
