// @three-ws/mocap — save, list, share, and replay motion-capture clips.
// Thin client over the auth'd /api/mocap/clips endpoints (the durable half of
// the in-browser mocap studio). Recording happens client-side; this SDK is the
// persistence layer. See README.md for the full reference.

import { createHttp, ThreeWsError } from './http.js';

export { ThreeWsError, PaymentRequiredError, DEFAULT_BASE_URL } from './http.js';

// The wire-format strings the store accepts, and the clip `kind` each maps to.
// Mirrors SUPPORTED_FORMATS / FORMAT_KIND in api/mocap/clips.js.
const FORMAT_KIND = {
	'three.ws.face-mocap.v1': 'face',
	'three.ws.pose-mocap.v1': 'pose',
	'three.ws.hand-mocap.v1': 'hand',
	'three.ws.vmc.v1': 'vmc',
};
const SUPPORTED_FORMATS = Object.keys(FORMAT_KIND);
const VISIBILITIES = ['private', 'unlisted', 'public'];
const KINDS = ['face', 'pose', 'hand', 'vmc'];

const MAX_FRAMES = 18_000; // matches MAX_FRAMES_INLINE server-side
const MAX_NAME = 120;

/**
 * Create a Mocap client bound to a base URL, fetch, and optional auth.
 * For most callers the default exports `saveClip()` / `getClip()` / `listClips()`
 * are enough; use this to reuse configuration (a session-aware fetch, a custom
 * origin, a default bearer token) across many calls.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl]  API origin (default https://three.ws).
 * @param {typeof fetch} [options.fetch]  fetch implementation (default global).
 * @param {string} [options.apiKey]  default bearer token for every call.
 * @param {string} [options.token]  alias for apiKey (matches the README's `auth.token`).
 * @param {Record<string,string>} [options.headers]  default headers on every call.
 */
export function createMocap(options = {}) {
	const request = createHttp({ ...options, apiKey: options.apiKey || options.token });

	/** Persist a browser recording. Wraps POST /api/mocap/clips. */
	async function saveClip(recording, meta = {}, auth) {
		const clip = normalizeRecording(recording);
		if (!meta || typeof meta.name !== 'string' || !meta.name.trim()) {
			throw new ThreeWsError('saveClip() needs `meta.name` (1–120 chars).', { code: 'invalid_input' });
		}
		if (meta.name.length > MAX_NAME) {
			throw new ThreeWsError(`meta.name must be ≤ ${MAX_NAME} chars.`, { code: 'invalid_input' });
		}
		const visibility = normalizeEnum(meta.visibility, VISIBILITIES, 'visibility');

		const body = prune({
			name: meta.name,
			slug: meta.slug,
			description: meta.description,
			avatar_id: meta.avatarId ?? meta.avatar_id,
			tags: meta.tags,
			visibility,
			clip,
		});

		const out = await request('/api/mocap/clips', {
			method: 'POST',
			body,
			headers: authHeaders(auth),
			signal: optSignal(auth, meta),
		});
		return shapeClip(out?.clip ?? out);
	}

	/** Fetch one clip with its full `frames` array. Wraps GET /api/mocap/clips/:id. */
	async function getClip(idOrSlug, auth) {
		const id = requireId(idOrSlug, 'getClip');
		const out = await request(`/api/mocap/clips/${encodeURIComponent(id)}`, {
			headers: authHeaders(auth),
			signal: optSignal(auth),
		});
		return shapeClip(out?.clip ?? out);
	}

	/** List clips without frames (metadata only). Wraps GET /api/mocap/clips. */
	async function listClips(auth, opts = {}) {
		const kind = normalizeEnum(opts.kind, KINDS, 'kind');
		const query = prune({
			limit: opts.limit != null ? clamp(opts.limit, 1, 100) : undefined,
			cursor: opts.cursor,
			kind,
			include_public: opts.includePublic ? 'true' : undefined,
		});
		const out = await request('/api/mocap/clips', {
			query,
			headers: authHeaders(auth),
			signal: optSignal(auth, opts),
		});
		return {
			items: (out?.items || []).map(shapeClip),
			nextCursor: out?.next_cursor ?? null,
			raw: out,
		};
	}

	/** Edit clip metadata (owner only). Wraps PATCH /api/mocap/clips/:id. */
	async function updateClip(idOrSlug, patch = {}, auth) {
		const id = requireId(idOrSlug, 'updateClip');
		const visibility = normalizeEnum(patch.visibility, VISIBILITIES, 'visibility');
		const body = prune({
			name: patch.name,
			description: patch.description,
			tags: patch.tags,
			visibility,
			avatar_id: 'avatarId' in patch ? patch.avatarId : patch.avatar_id,
			price: patch.price,
		}, { keepNull: ['avatar_id', 'price'] });

		if (Object.keys(body).length === 0) {
			throw new ThreeWsError('updateClip() needs at least one field to patch.', { code: 'invalid_input' });
		}
		const out = await request(`/api/mocap/clips/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body,
			headers: authHeaders(auth),
			signal: optSignal(auth, patch),
		});
		return shapeClip(out?.clip ?? out);
	}

	/** Soft-delete a clip you own. Wraps DELETE /api/mocap/clips/:id. */
	async function deleteClip(idOrSlug, auth) {
		const id = requireId(idOrSlug, 'deleteClip');
		const out = await request(`/api/mocap/clips/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: authHeaders(auth),
			signal: optSignal(auth),
		});
		return { ok: out?.ok === true };
	}

	return { saveClip, getClip, listClips, updateClip, deleteClip };
}

// A module-level default client for the zero-config path: `import { saveClip }`.
let shared = null;
function defaultClient() {
	return (shared ||= createMocap());
}

/** Persist a browser recording to your library. */
export function saveClip(recording, meta, auth) {
	return defaultClient().saveClip(recording, meta, auth);
}
/** Fetch one clip with its full frames array, ready to replay. */
export function getClip(idOrSlug, auth) {
	return defaultClient().getClip(idOrSlug, auth);
}
/** List clips (metadata only), cursor-paginated, newest first. */
export function listClips(auth, opts) {
	return defaultClient().listClips(auth, opts);
}
/** Edit a clip's metadata (name, description, tags, visibility, avatar, price). */
export function updateClip(idOrSlug, patch, auth) {
	return defaultClient().updateClip(idOrSlug, patch, auth);
}
/** Soft-delete a clip you own. */
export function deleteClip(idOrSlug, auth) {
	return defaultClient().deleteClip(idOrSlug, auth);
}

/** The wire-format strings the store accepts. */
export const supportedFormats = SUPPORTED_FORMATS.slice();
/** Map a format string to its clip kind (`face` / `pose` / `hand` / `vmc`). */
export function formatKind(format) {
	return FORMAT_KIND[format] ?? null;
}

// ---- internals --------------------------------------------------------------

// Validate the recording the capture runtime handed us before any network call.
function normalizeRecording(recording) {
	if (!recording || typeof recording !== 'object') {
		throw new ThreeWsError('saveClip() needs the recording object from getRecording().', { code: 'invalid_input' });
	}
	const { format, duration, frames } = recording;
	if (typeof format !== 'string' || !FORMAT_KIND[format]) {
		throw new ThreeWsError(
			`Unsupported recording format "${format}". Expected one of: ${SUPPORTED_FORMATS.join(', ')}.`,
			{ code: 'unsupported_format' },
		);
	}
	if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 3600) {
		throw new ThreeWsError('recording.duration must be a number in seconds, 0–3600.', { code: 'invalid_input' });
	}
	if (!Array.isArray(frames) || frames.length === 0) {
		throw new ThreeWsError('recording.frames must be a non-empty array.', { code: 'invalid_input' });
	}
	if (frames.length > MAX_FRAMES) {
		throw new ThreeWsError(`recording.frames exceeds ${MAX_FRAMES} — split the capture.`, { code: 'invalid_input' });
	}
	// Pass frames through as-is (server re-validates each); just assert the
	// outer shape so a malformed buffer fails fast with a clear message.
	return { format, duration, frames };
}

// Per-call auth: `{ token }` → Authorization bearer that overrides the client default.
function authHeaders(auth) {
	const token = typeof auth === 'string' ? auth : auth?.token;
	const headers = { ...(auth?.headers || {}) };
	if (token) headers.authorization = `Bearer ${token}`;
	return Object.keys(headers).length ? headers : undefined;
}

function optSignal(auth, opts) {
	return auth?.signal ?? opts?.signal;
}

function shapeClip(row) {
	if (!row || typeof row !== 'object') {
		throw new ThreeWsError('Unexpected empty response from /api/mocap/clips.', { code: 'bad_response' });
	}
	const durationMs = row.duration_ms ?? null;
	return {
		id: row.id ?? null,
		slug: row.slug ?? null,
		name: row.name ?? null,
		description: row.description ?? null,
		kind: row.kind ?? null,
		format: row.format ?? null,
		durationMs,
		duration: row.duration ?? (durationMs != null ? durationMs / 1000 : null),
		frameCount: row.frame_count ?? null,
		frames: row.frames ?? null,
		tags: row.tags ?? [],
		visibility: row.visibility ?? null,
		avatarId: row.avatar_id ?? null,
		playCount: row.play_count != null ? Number(row.play_count) : null,
		price: row.price ?? null,
		owner: row.owner ?? null,
		createdAt: row.created_at ?? null,
		updatedAt: row.updated_at ?? null,
		raw: row,
	};
}

function requireId(idOrSlug, fn) {
	if (typeof idOrSlug !== 'string' || !idOrSlug.trim()) {
		throw new ThreeWsError(`${fn}() needs a clip id or slug.`, { code: 'invalid_input' });
	}
	return idOrSlug.trim();
}

function normalizeEnum(value, allowed, label) {
	if (value === undefined || value === null) return undefined;
	if (!allowed.includes(value)) {
		throw new ThreeWsError(`Invalid ${label} "${value}". Expected one of: ${allowed.join(', ')}.`, { code: 'invalid_input' });
	}
	return value;
}

function clamp(n, lo, hi) {
	const v = Math.trunc(Number(n));
	if (!Number.isFinite(v)) return lo;
	return Math.min(Math.max(v, lo), hi);
}

// Drop undefined / empty-array fields. `keepNull` lists keys whose explicit
// null is meaningful to the endpoint (price: null clears a price; avatar_id:
// null unbinds an avatar) and must survive pruning.
function prune(obj, { keepNull = [] } = {}) {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined) continue;
		if (v === null) {
			if (keepNull.includes(k)) out[k] = null;
			continue;
		}
		if (Array.isArray(v) && v.length === 0) continue;
		out[k] = v;
	}
	return out;
}
