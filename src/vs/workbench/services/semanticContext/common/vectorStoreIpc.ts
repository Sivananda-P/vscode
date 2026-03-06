/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Event } from '../../../../base/common/event.js';
import { IVectorStoreService } from './vectorStore.js';
import { URI } from '../../../../base/common/uri.js';

export class VectorStoreChannel implements IServerChannel {

	constructor(private service: IVectorStoreService) { }

	listen(_: unknown, event: string): Event<any> {
		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, args?: any): Promise<any> {
		switch (command) {
			case 'init': return this.service.init();
			case 'addChunks': return this.service.addChunks(args[0], args[1]);
			case 'deleteChunks': return this.service.deleteChunks(URI.revive(args[0]));
			case 'search': return this.service.search(args[0], args[1]);
			case 'getFileMtimes': return this.service.getFileMtimes();
			case 'rebuildIndex': return this.service.rebuildIndex();
			case 'close': return this.service.close();
		}

		throw new Error(`Call not found: ${command}`);
	}
}
