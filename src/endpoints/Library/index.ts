import type { AxiosInstance } from "axios";
import { getAuthenticatedAxios } from "../../utils/AxiosManager";
import type { AppleMusicConfig } from "../../utils/Config";

const NOT_INITIALIZED_ERROR =
	"LibraryEndpoint.init() must be called before performing requests.";

const MAX_PAGE_SIZE = 100;
const MAX_ADD_BATCH_SIZE = 50;

/**
 * A song in the user's library. `playParams.catalogId` is missing for uploads
 * that have no equivalent in the Apple Music catalog.
 * @category Endpoints
 */
export type LibrarySong = {
	id: string;
	type: "library-songs";
	attributes?: {
		name?: string;
		artistName?: string;
		albumName?: string;
		durationInMillis?: number;
		playParams?: { id?: string; kind?: string; catalogId?: string };
	};
};

/**
 * One page of a library resource.
 * @category Endpoints
 */
export type LibraryPage<T = unknown> = {
	data: T[];
	next?: string;
	meta?: { total?: number };
};

/**
 * Result of reading every page of the user's library songs.
 * @category Endpoints
 */
export type LibrarySongsResult = {
	songs: LibrarySong[];
	/** False when the pages returned fewer songs than Apple reported. */
	complete: boolean;
	total?: number;
};

/**
 * Endpoint for reading and changing the user's personal Apple Music library.
 * Requires `userToken` in the client configuration.
 *
 * @category Endpoints
 */
export class LibraryEndpoint {
	private ax: AxiosInstance | null = null;
	private readonly baseURL: string;

	constructor(config: AppleMusicConfig) {
		this.baseURL = config.getBaseURL();
	}

	/**
	 * Initializes the authenticated Axios client for Library operations.
	 */
	public async init(): Promise<void> {
		this.ax = await getAuthenticatedAxios();
	}

	/**
	 * Retrieve one page of the user's library albums.
	 */
	public async getAlbums(limit = 25, offset = 0): Promise<LibraryPage> {
		return this.getPage(`/albums?limit=${limit}&offset=${offset}`);
	}

	/**
	 * Retrieve one page of the user's library playlists.
	 */
	public async getPlaylists(limit = 25, offset = 0): Promise<LibraryPage> {
		return this.getPage(`/playlists?limit=${limit}&offset=${offset}`);
	}

	/**
	 * Retrieve one page of the user's library songs.
	 */
	public async getSongs(
		limit = 25,
		offset = 0,
	): Promise<LibraryPage<LibrarySong>> {
		return this.getPage(`/songs?limit=${limit}&offset=${offset}`);
	}

	/**
	 * Retrieve every song in the user's library.
	 *
	 * A failed page rejects instead of returning a partial list, so callers can
	 * never mistake missing pages for songs the user removed.
	 */
	public async getAllSongs(): Promise<LibrarySongsResult> {
		const songs: LibrarySong[] = [];
		const seenPages = new Set<string>();
		let total: number | undefined;
		let path: string | undefined = `/songs?limit=${MAX_PAGE_SIZE}&offset=0`;
		let endedEarly = false;

		while (path) {
			if (seenPages.has(path)) {
				endedEarly = true;
				break;
			}
			seenPages.add(path);

			const page: LibraryPage<LibrarySong> = await this.getPage(path);
			songs.push(...(page.data ?? []));
			total = page.meta?.total ?? total;
			path = page.next ? this.nextPagePath(page.next) : undefined;
		}

		return {
			songs,
			complete: !endedEarly && (total === undefined || songs.length >= total),
			total,
		};
	}

	/**
	 * Add catalog songs to the user's library.
	 *
	 * @param catalogIds - Apple Music catalog song ids, not library ids.
	 */
	public async addSongs(catalogIds: string[]): Promise<void> {
		const client = this.requireClient();
		for (let i = 0; i < catalogIds.length; i += MAX_ADD_BATCH_SIZE) {
			const ids = catalogIds
				.slice(i, i + MAX_ADD_BATCH_SIZE)
				.map(encodeURIComponent)
				.join(",");
			await client.post(`${this.baseURL}/v1/me/library?ids[songs]=${ids}`);
		}
	}

	/**
	 * Remove a song from the user's library. This host is not part of Apple's
	 * documented API, so it can stop working without notice.
	 *
	 * @param libraryId - Library song id, such as `i.abc123`, not a catalog id.
	 */
	public async removeSong(libraryId: string): Promise<void> {
		const client = this.requireClient();
		await client.delete(
			`${this.baseURL}/v1/me/library/songs/${encodeURIComponent(libraryId)}`,
		);
	}

	private async getPage<T>(path: string): Promise<LibraryPage<T>> {
		const client = this.requireClient();
		const res = await client.get(`${this.baseURL}/v1/me/library${path}`);
		return res.data;
	}

	/** Apple returns `next` as a path from the host, such as `/v1/me/library/songs?offset=100`. */
	private nextPagePath(next: string): string {
		const path = next.slice(next.indexOf("/v1/me/library") + "/v1/me/library".length);
		return path.includes("limit=") ? path : `${path}&limit=${MAX_PAGE_SIZE}`;
	}

	/**
	 * Ensures the Axios client is initialized before making requests.
	 */
	private requireClient(): AxiosInstance {
		if (!this.ax) throw new Error(NOT_INITIALIZED_ERROR);
		return this.ax;
	}
}
