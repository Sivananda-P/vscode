/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { INativeEmbeddingService } from '../common/nativeEmbeddingService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

export class NativeEmbeddingServiceClient implements INativeEmbeddingService {
	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService
	) {
		this.channel = sharedProcessService.getChannel('nativeEmbedding');
	}

	async provideEmbeddings(texts: string[], token: CancellationToken): Promise<VSBuffer[]> {
		return this.channel.call('provideEmbeddings', [texts, token]);
	}
}
