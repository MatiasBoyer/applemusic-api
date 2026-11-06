import type { AxiosInstance } from "axios";
import { getAuthenticatedAxios } from "../../utils/AxiosManager";
import type { AppleMusicConfig } from "../../utils/Config";

function isStatus(error: unknown, status: number): boolean {
	return (
		(error as { response?: { status?: number } } | null)?.response?.status ===
		status
	);
}

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
 * A playlist in the user's library. Only playlists with `canEdit` accept changes.
 * @category Endpoints
 */
export type LibraryPlaylist = {
	id: string;
	type: "library-playlists";
	attributes?: {
		name?: string;
		description?: { standard?: string };
		canEdit?: boolean;
		isPublic?: boolean;
	};
};

/**
 * Ways of removing songs from a playlist. Apple documents none, so the one
 * that works has to be found by trying them.
 * @category Endpoints
 */
export type PlaylistRemoveStrategy = "query" | "body";
export const PLAYLIST_REMOVE_STRATEGIES: PlaylistRemoveStrategy[] = [
	"query",
	"body",
];

/**
 * Result of reading every page of a library resource.
 * @category Endpoints
 */
export type AllPagesResult<T> = {
	items: T[];
	/** False when the pages returned fewer items than Apple reported. */
	complete: boolean;
	total?: number;
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
		const { items, complete, total } = await this.getAllPages<LibrarySong>(
			`/songs?limit=${MAX_PAGE_SIZE}&offset=0`,
		);
		return { songs: items, complete, total };
	}

	/**
	 * Retrieve every playlist in the user's library.
	 */
	public async getAllPlaylists(): Promise<AllPagesResult<LibraryPlaylist>> {
		return this.getAllPages<LibraryPlaylist>(
			`/playlists?limit=${MAX_PAGE_SIZE}&offset=0`,
		);
	}

	/**
	 * Create a playlist in the user's library.
	 *
	 * @returns The new playlist.
	 */
	public async createPlaylist(
		name: string,
		description?: string,
	): Promise<LibraryPlaylist> {
		const client = this.requireClient();
		const res = await client.post(`${this.baseURL}/v1/me/library/playlists`, {
			attributes: {
				name,
				...(description ? { description } : {}),
			},
		});
		const playlist = res.data?.data?.[0] as LibraryPlaylist | undefined;
		if (!playlist) throw new Error("Apple did not return the new playlist");
		return playlist;
	}

	/**
	 * Retrieve every song in a library playlist. Each item's `id` is its
	 * library id, used to remove it, and `playParams.catalogId` its catalog id.
	 */
	public async getAllPlaylistTracks(
		playlistId: string,
	): Promise<AllPagesResult<LibrarySong>> {
		try {
			return await this.getAllPages<LibrarySong>(
				`/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${MAX_PAGE_SIZE}&offset=0`,
			);
		} catch (error) {
			// Apple answers 404 for the tracks of an empty playlist.
			if (isStatus(error, 404)) return { items: [], complete: true, total: 0 };
			throw error;
		}
	}

	/**
	 * Add catalog songs to a library playlist.
	 *
	 * @param catalogIds - Apple Music catalog song ids.
	 */
	public async addTracksToPlaylist(
		playlistId: string,
		catalogIds: string[],
	): Promise<void> {
		const client = this.requireClient();
		for (let i = 0; i < catalogIds.length; i += MAX_ADD_BATCH_SIZE) {
			await client.post(
				`${this.baseURL}/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks`,
				{
					data: catalogIds
						.slice(i, i + MAX_ADD_BATCH_SIZE)
						.map((id) => ({ id, type: "songs" })),
				},
			);
		}
	}

	/**
	 * Remove songs from a library playlist. Apple does not document this, so it
	 * can stop working without notice; find the strategy that works by trying
	 * each one in {@link PLAYLIST_REMOVE_STRATEGIES}.
	 *
	 * @param libraryIds - Library song ids, as returned by {@link getAllPlaylistTracks}.
	 */
	public async removeTracksFromPlaylist(
		playlistId: string,
		libraryIds: string[],
		strategy: PlaylistRemoveStrategy,
	): Promise<void> {
		if (libraryIds.length === 0) return;
		const client = this.requireClient();
		const url = `${this.baseURL}/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks`;
		if (strategy === "query") {
			const ids = libraryIds.map(encodeURIComponent).join(",");
			await client.delete(`${url}?ids[library-songs]=${ids}&mode=all`);
		} else {
			await client.delete(url, {
				data: { data: libraryIds.map((id) => ({ id, type: "library-songs" })) },
			});
		}
	}

	/**
	 * Read every page of a library resource. Stops and reports an incomplete
	 * read if Apple repeats a page.
	 */
	private async getAllPages<T>(firstPath: string): Promise<AllPagesResult<T>> {
		const items: T[] = [];
		const seenPages = new Set<string>();
		let total: number | undefined;
		let path: string | undefined = firstPath;
		let endedEarly = false;

		while (path) {
			if (seenPages.has(path)) {
				endedEarly = true;
				break;
			}
			seenPages.add(path);

			const page: LibraryPage<T> = await this.getPage(path);
			items.push(...(page.data ?? []));
			total = page.meta?.total ?? total;
			path = page.next ? this.nextPagePath(page.next) : undefined;
		}

		return {
			items,
			complete: !endedEarly && (total === undefined || items.length >= total),
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
