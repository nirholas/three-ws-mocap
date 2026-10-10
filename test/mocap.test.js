import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMocap, ThreeWsError, PaymentRequiredError, supportedFormats, formatKind } from '../src/index.js';

// A scripted fetch double: each call shifts the next queued response and records
// the request. No network, no real endpoints — we assert on request shaping and
// response parsing, which is all the SDK is responsible for.
function stubFetch(responses) {
	const calls = [];
	const queue = [...responses];
	const fetch = async (url, init) => {
		calls.push({ url: new URL(url), init });
		const next = queue.shift();
		if (!next) throw new Error('stubFetch: no more queued responses');
		const { status = 200, body = {}, headers = {} } = next;
		return {
			ok: status >= 200 && status < 300,
			status,
			headers: { get: (k) => headers[k.toLowerCase()] ?? null },
			text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
		};
	};
	return { fetch, calls };
}

const recording = {
	format: 'three.ws.face-mocap.v1',
	duration: 2.5,
	frames: [
		{ t: 0, shapes: { jawOpen: 0.1 }, mat: null },
		{ t: 0.033, shapes: { jawOpen: 0.4 }, mat: null },
	],
};

test('saveClip() posts clip + meta and shapes the created clip', async () => {
	const { fetch, calls } = stubFetch([
		{ status: 201, body: { clip: { id: 'cl_1', slug: 'surprised-reaction', name: 'Surprised reaction', kind: 'face', format: 'three.ws.face-mocap.v1', duration_ms: 2500, frame_count: 2, tags: ['emote'], visibility: 'private', avatar_id: null, created_at: '2026-06-23T00:00:00Z', updated_at: '2026-06-23T00:00:00Z' } } },
	]);
	const client = createMocap({ fetch, baseUrl: 'https://three.ws' });
	const clip = await client.saveClip(recording, { name: 'Surprised reaction', tags: ['emote'] }, { token: 'sk_test' });

	assert.equal(calls[0].url.pathname, '/api/mocap/clips');
	assert.equal(calls[0].init.method, 'POST');
	assert.equal(calls[0].init.headers.authorization, 'Bearer sk_test');
	const sent = JSON.parse(calls[0].init.body);
	assert.equal(sent.name, 'Surprised reaction');
	assert.deepEqual(sent.tags, ['emote']);
	assert.equal(sent.clip.format, 'three.ws.face-mocap.v1');
	assert.equal(sent.clip.frames.length, 2);
	assert.ok(!('slug' in sent), 'unset meta fields are pruned');
	// camelCase mapping + duration derivation
	assert.equal(clip.id, 'cl_1');
	assert.equal(clip.frameCount, 2);
	assert.equal(clip.durationMs, 2500);
	assert.equal(clip.duration, 2.5);
	assert.equal(clip.kind, 'face');
});

test('getClip() fetches by id/slug and surfaces frames + duration', async () => {
	const { fetch, calls } = stubFetch([
		{ body: { clip: { id: 'cl_2', slug: 'wink', kind: 'face', format: 'three.ws.face-mocap.v1', duration_ms: 1000, duration: 1, frame_count: 1, frames: [{ t: 0, shapes: {}, mat: null }], tags: [], visibility: 'public', play_count: 7, price: null, owner: 'other' } } },
	]);
	const client = createMocap({ fetch });
	const clip = await client.getClip('wink');

	assert.equal(calls[0].url.pathname, '/api/mocap/clips/wink');
	assert.equal(calls[0].init.method, 'GET');
	assert.equal(clip.frames.length, 1);
	assert.equal(clip.duration, 1);
	assert.equal(clip.playCount, 7);
	assert.equal(clip.owner, 'other');
});

test('listClips() maps options to query params and parses next_cursor', async () => {
	const { fetch, calls } = stubFetch([
		{ body: { items: [{ id: 'a', kind: 'face', frame_count: 3 }], next_cursor: 'CUR2' } },
	]);
	const client = createMocap({ fetch });
	const page = await client.listClips({ token: 'sk' }, { kind: 'face', limit: 500, includePublic: true, cursor: 'CUR1' });

	const q = calls[0].url.searchParams;
	assert.equal(q.get('kind'), 'face');
	assert.equal(q.get('limit'), '100', 'limit is clamped to 100');
	assert.equal(q.get('include_public'), 'true');
	assert.equal(q.get('cursor'), 'CUR1');
	assert.equal(page.nextCursor, 'CUR2');
	assert.equal(page.items[0].frameCount, 3);
});

test('updateClip() sends price:null through the prune and PATCHes', async () => {
	const { fetch, calls } = stubFetch([
		{ body: { clip: { id: 'cl_3', name: 'renamed', visibility: 'unlisted', price: null } } },
	]);
	const client = createMocap({ fetch });
	await client.updateClip('cl_3', { name: 'renamed', price: null, avatarId: null }, { token: 'sk' });

	assert.equal(calls[0].init.method, 'PATCH');
	const sent = JSON.parse(calls[0].init.body);
	assert.equal(sent.name, 'renamed');
	assert.equal(sent.price, null, 'explicit null price survives pruning');
	assert.equal(sent.avatar_id, null, 'explicit null avatar_id survives pruning');
});

test('deleteClip() DELETEs and returns { ok }', async () => {
	const { fetch, calls } = stubFetch([{ body: { ok: true } }]);
	const client = createMocap({ fetch });
	const res = await client.deleteClip('cl_4', { token: 'sk' });
	assert.equal(calls[0].init.method, 'DELETE');
	assert.equal(calls[0].url.pathname, '/api/mocap/clips/cl_4');
	assert.deepEqual(res, { ok: true });
});

test('invalid inputs are rejected before any network call', async () => {
	const { fetch, calls } = stubFetch([]);
	const client = createMocap({ fetch });
	await assert.rejects(() => client.saveClip(recording, {}), /needs `meta.name`/);
	await assert.rejects(() => client.saveClip({ ...recording, format: 'bogus' }, { name: 'x' }), /Unsupported recording format/);
	await assert.rejects(() => client.saveClip({ format: 'three.ws.face-mocap.v1', duration: 1, frames: [] }, { name: 'x' }), /non-empty array/);
	await assert.rejects(() => client.listClips({}, { kind: 'voxel' }), /Invalid kind/);
	await assert.rejects(() => client.updateClip('id', {}), /at least one field/);
	await assert.rejects(() => client.getClip(''), /needs a clip id or slug/);
	assert.equal(calls.length, 0);
});

test('unsupported_format (400) surfaces as a typed ThreeWsError', async () => {
	const { fetch } = stubFetch([{ status: 400, body: { error: 'unsupported_format', message: 'format x not supported' } }]);
	const client = createMocap({ fetch });
	// A format the SDK considers valid but the server rejects (e.g. version skew).
	await assert.rejects(
		() => client.saveClip({ format: 'three.ws.vmc.v1', duration: 1, frames: [{ t: 0, shapes: {} }] }, { name: 'stream' }, { token: 'sk' }),
		(e) => {
			assert.ok(e instanceof ThreeWsError);
			assert.equal(e.code, 'unsupported_format');
			assert.equal(e.status, 400);
			return true;
		},
	);
});

test('402 on a priced clip surfaces as PaymentRequiredError with the x402 challenge', async () => {
	const accepts = [{ scheme: 'exact', asset: 'USDC', network: 'eip155:8453', maxAmountRequired: '50000' }];
	const { fetch } = stubFetch([{ status: 402, body: { error: 'payment_required', message: 'pay', accepts } }]);
	const client = createMocap({ fetch });
	await assert.rejects(() => client.getClip('priced-clip'), (e) => {
		assert.ok(e instanceof PaymentRequiredError);
		assert.deepEqual(e.accepts, accepts);
		return true;
	});
});

test('exported helpers describe the supported wire formats', () => {
	assert.ok(supportedFormats.includes('three.ws.face-mocap.v1'));
	assert.equal(formatKind('three.ws.pose-mocap.v1'), 'pose');
	assert.equal(formatKind('three.ws.vmc.v1'), 'vmc');
	assert.equal(formatKind('nope'), null);
});
