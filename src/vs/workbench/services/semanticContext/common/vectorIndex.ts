/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A Vantage Point (VP) Tree implementation for efficient nearest neighbor search in high-dimensional space.
 * Provides O(log N) search complexity in most cases.
 */
export class VPTree<T> {
	private root: VPNode<T> | null = null;

	constructor(
		private readonly distanceFn: (a: Float32Array, b: Float32Array) => number
	) { }

	build(items: { vector: Float32Array; metadata: T }[]): void {
		if (items.length === 0) {
			this.root = null;
			return;
		}
		this.root = this.recursiveBuild(items);
	}

	private recursiveBuild(items: { vector: Float32Array; metadata: T }[]): VPNode<T> {
		if (items.length === 1) {
			return new VPNode(items[0].vector, items[0].metadata);
		}

		// Pick a vantage point (simple: pick the first one)
		const vantageItem = items[0];
		const remaining = items.slice(1);

		// Calculate distances to the vantage point
		const distances = remaining.map(item => ({
			item,
			dist: this.distanceFn(vantageItem.vector, item.vector)
		}));

		// Sort by distance to find the median
		distances.sort((a, b) => a.dist - b.dist);
		const medianIdx = Math.floor(distances.length / 2);
		const radius = distances[medianIdx]?.dist ?? 0;

		const leftItems = distances.slice(0, medianIdx).map(d => d.item);
		const rightItems = distances.slice(medianIdx).map(d => d.item);

		const node = new VPNode(vantageItem.vector, vantageItem.metadata);
		node.threshold = radius;
		if (leftItems.length > 0) node.left = this.recursiveBuild(leftItems);
		if (rightItems.length > 0) node.right = this.recursiveBuild(rightItems);

		return node;
	}

	search(query: Float32Array, k: number): { metadata: T; distance: number }[] {
		if (!this.root) return [];

		const results: { metadata: T; distance: number }[] = [];
		let tau = Infinity; // Current k-th best distance

		const searchNode = (node: VPNode<T>) => {
			const dist = this.distanceFn(query, node.vector);

			if (dist < tau) {
				results.push({ metadata: node.metadata, distance: dist });
				results.sort((a, b) => a.distance - b.distance);
				if (results.length > k) {
					results.pop();
				}
				if (results.length === k) {
					tau = results[k - 1].distance;
				}
			}

			if (node.left && dist - tau <= node.threshold!) {
				searchNode(node.left);
			}

			if (node.right && dist + tau >= node.threshold!) {
				searchNode(node.right);
			}
		};

		searchNode(this.root);
		return results;
	}
}

class VPNode<T> {
	threshold: number | null = null;
	left: VPNode<T> | null = null;
	right: VPNode<T> | null = null;

	constructor(
		public readonly vector: Float32Array,
		public readonly metadata: T
	) { }
}

/**
 * Standard Cosine Distance (1 - similarity)
 */
export function cosineDistance(v1: Float32Array, v2: Float32Array): number {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < v1.length; i++) {
		dot += v1[i] * v2[i];
		na += v1[i] * v1[i];
		nb += v2[i] * v2[i];
	}
	const similarity = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
	return 1 - similarity; // Distance where 0 is identical
}
