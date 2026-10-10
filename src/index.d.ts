// Type definitions for @three-ws/mocap

export declare class ThreeWsError extends Error {
	name: string;
	code: string;
	status: number | null;
	detail?: string;
	retryAfter?: number;
	body: unknown;
}

export declare class PaymentRequiredError extends ThreeWsError {
	accepts: unknown | null;
}

export declare const DEFAULT_BASE_URL: string;

export type ClipKind = 'face' | 'pose' | 'hand' | 'vmc';
export type Visibility = 'private' | 'unlisted' | 'public';
export type ClipOwner = 'self' | 'other';

/** One captured frame. `t` is seconds from clip start. */
export interface Frame {
	t: number;
	shapes: Record<string, number>;
	mat?: number[] | null;
}

/** The object the capture runtime's `getRecording()` returns. */
export interface Recording {
	format: string;
	duration: number;
	frames: Frame[];
}

export interface Price {
	amount: string;
	currency: string;
}

/** Per-call authentication. Pass a bearer token, or rely on a session cookie. */
export interface Auth {
	/** Bearer token attached as `Authorization` for this call. */
	token?: string;
	/** Extra headers merged into the request. */
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

export interface SaveMeta {
	/** Required. 1–120 chars. */
	name: string;
	/** `^[a-z0-9][a-z0-9-]{0,79}$`, unique per owner. Auto-derived from `name` if omitted. */
	slug?: string;
	description?: string;
	/** Up to 20 tags, ≤40 chars each. */
	tags?: string[];
	visibility?: Visibility;
	/** Bind the clip to one of your avatars (must be owned by you). */
	avatarId?: string;
	/** Snake-case alias for `avatarId`. */
	avatar_id?: string;
	signal?: AbortSignal;
}

export interface ListOptions {
	/** Clamped to 1–100. Default 50. */
	limit?: number;
	/** `nextCursor` from the previous page. */
	cursor?: string;
	kind?: ClipKind;
	/** Authed: union your clips with the public pool. */
	includePublic?: boolean;
	signal?: AbortSignal;
}

export interface UpdatePatch {
	name?: string;
	description?: string;
	tags?: string[];
	visibility?: Visibility;
	/** Bind/unbind an avatar; `null` unbinds. */
	avatarId?: string | null;
	avatar_id?: string | null;
	/** Set a sale price, or `null` to make the clip free again. */
	price?: Price | null;
	signal?: AbortSignal;
}

/** A mocap clip. `frames` is populated only by `getClip`. */
export interface Clip {
	id: string | null;
	slug: string | null;
	name: string | null;
	description: string | null;
	kind: ClipKind | null;
	format: string | null;
	durationMs: number | null;
	duration: number | null;
	frameCount: number | null;
	/** Present only on `getClip`; `null` from list/save/update. */
	frames: Frame[] | null;
	tags: string[];
	visibility: Visibility | null;
	avatarId: string | null;
	playCount: number | null;
	price: Price | null;
	owner: ClipOwner | null;
	createdAt: string | null;
	updatedAt: string | null;
	/** Raw endpoint payload, for fields not surfaced above. */
	raw: unknown;
}

export interface ClipPage {
	items: Clip[];
	nextCursor: string | null;
	raw: unknown;
}

export interface MocapClientOptions {
	baseUrl?: string;
	fetch?: typeof fetch;
	/** Default bearer token for every call. */
	apiKey?: string;
	/** Alias for `apiKey` (matches the README's `auth.token`). */
	token?: string;
	headers?: Record<string, string>;
}

export interface MocapClient {
	saveClip(recording: Recording, meta: SaveMeta, auth?: Auth | string): Promise<Clip>;
	getClip(idOrSlug: string, auth?: Auth | string): Promise<Clip>;
	listClips(auth?: Auth | string, opts?: ListOptions): Promise<ClipPage>;
	updateClip(idOrSlug: string, patch: UpdatePatch, auth?: Auth | string): Promise<Clip>;
	deleteClip(idOrSlug: string, auth?: Auth | string): Promise<{ ok: boolean }>;
}

export declare function createMocap(options?: MocapClientOptions): MocapClient;
export declare function saveClip(recording: Recording, meta: SaveMeta, auth?: Auth | string): Promise<Clip>;
export declare function getClip(idOrSlug: string, auth?: Auth | string): Promise<Clip>;
export declare function listClips(auth?: Auth | string, opts?: ListOptions): Promise<ClipPage>;
export declare function updateClip(idOrSlug: string, patch: UpdatePatch, auth?: Auth | string): Promise<Clip>;
export declare function deleteClip(idOrSlug: string, auth?: Auth | string): Promise<{ ok: boolean }>;

/** The wire-format strings the store accepts. */
export declare const supportedFormats: string[];
/** Map a format string to its clip kind, or `null` if unknown. */
export declare function formatKind(format: string): ClipKind | null;
