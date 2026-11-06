import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppleMusicConfig } from "../../utils/Config";
import { LibraryEndpoint } from "./index";

const mockGetAuthenticatedAxios = vi.hoisted(() => vi.fn());

vi.mock("../../utils/AxiosManager", () => ({
	getAuthenticatedAxios: mockGetAuthenticatedAxios,
}));

describe("LibraryEndpoint", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockGetAuthenticatedAxios.mockReset();
	});

	const createAxiosInstance = (): {
		instance: AxiosInstance;
		get: ReturnType<typeof vi.fn>;
		post: ReturnType<typeof vi.fn>;
		del: ReturnType<typeof vi.fn>;
	} => {
		const get = vi.fn();
		const post = vi.fn();
		const del = vi.fn();
		const instance = {
			get,
			post,
			delete: del,
		} as unknown as AxiosInstance;
		return { instance, get, post, del } as const;
	};

	const initEndpoint = async () => {
		const mocks = createAxiosInstance();
		mockGetAuthenticatedAxios.mockResolvedValueOnce(mocks.instance);
		const config = new AppleMusicConfig();
		const endpoint = new LibraryEndpoint(config);
		await endpoint.init();
		return { ...mocks, endpoint, base: config.getBaseURL() };
	};

	const song = (id: string) => ({ id, type: "library-songs" });

	test("getAllSongs follows every page", async () => {
		const { endpoint, get, base } = await initEndpoint();
		get
			.mockResolvedValueOnce({
				data: {
					data: [song("i.1")],
					next: "/v1/me/library/songs?offset=100",
					meta: { total: 2 },
				},
			})
			.mockResolvedValueOnce({
				data: { data: [song("i.2")], meta: { total: 2 } },
			});

		const result = await endpoint.getAllSongs();

		expect(get).toHaveBeenNthCalledWith(
			1,
			`${base}/v1/me/library/songs?limit=100&offset=0`,
		);
		expect(get).toHaveBeenNthCalledWith(
			2,
			`${base}/v1/me/library/songs?offset=100&limit=100`,
		);
		expect(result).toEqual({
			songs: [song("i.1"), song("i.2")],
			complete: true,
			total: 2,
		});
	});

	test("getAllSongs reports fewer songs than the total as incomplete", async () => {
		const { endpoint, get } = await initEndpoint();
		get.mockResolvedValueOnce({
			data: { data: [song("i.1")], meta: { total: 5 } },
		});

		expect((await endpoint.getAllSongs()).complete).toBe(false);
	});

	test("getAllSongs stops and reports incomplete when a page repeats", async () => {
		const { endpoint, get } = await initEndpoint();
		get.mockResolvedValue({
			data: {
				data: [song("i.1")],
				next: "/v1/me/library/songs?offset=100",
			},
		});

		const result = await endpoint.getAllSongs();

		expect(get).toHaveBeenCalledTimes(2);
		expect(result.complete).toBe(false);
	});

	test("getAllSongs rejects when a page fails", async () => {
		const { endpoint, get } = await initEndpoint();
		get.mockResolvedValueOnce({
			data: { data: [song("i.1")], next: "/v1/me/library/songs?offset=100" },
		});
		get.mockRejectedValueOnce(new Error("boom"));

		await expect(endpoint.getAllSongs()).rejects.toThrow("boom");
	});

	test("addSongs sends catalog ids in batches", async () => {
		const { endpoint, post, base } = await initEndpoint();
		post.mockResolvedValue({ status: 202 });
		const ids = Array.from({ length: 51 }, (_, i) => String(i));

		await endpoint.addSongs(ids);

		expect(post).toHaveBeenCalledTimes(2);
		expect(post).toHaveBeenNthCalledWith(
			2,
			`${base}/v1/me/library?ids[songs]=50`,
		);
	});

	test("addSongs does nothing without ids", async () => {
		const { endpoint, post } = await initEndpoint();
		await endpoint.addSongs([]);
		expect(post).not.toHaveBeenCalled();
	});

	test("removeSong deletes by library id", async () => {
		const { endpoint, del, base } = await initEndpoint();
		del.mockResolvedValueOnce({ status: 204 });

		await endpoint.removeSong("i.abc");

		expect(del).toHaveBeenCalledWith(`${base}/v1/me/library/songs/i.abc`);
	});

	test("init wires authenticated axios instance", async () => {
		const { instance: axiosInstance } = createAxiosInstance();
		mockGetAuthenticatedAxios.mockResolvedValueOnce(axiosInstance);
		const endpoint = new LibraryEndpoint(new AppleMusicConfig());

		await endpoint.init();

		expect(mockGetAuthenticatedAxios).toHaveBeenCalledTimes(1);
	});

	test("throws error if not initialized", async () => {
		const endpoint = new LibraryEndpoint(new AppleMusicConfig());
		await expect(endpoint.getAlbums()).rejects.toThrow(
			"LibraryEndpoint.init() must be called before performing requests.",
		);
	});

	test("getAlbums fetches from correct URL", async () => {
		const { instance: axiosInstance, get: axiosGet } = createAxiosInstance();
		mockGetAuthenticatedAxios.mockResolvedValueOnce(axiosInstance);
		const config = new AppleMusicConfig();
		const endpoint = new LibraryEndpoint(config);

		await endpoint.init();
		axiosGet.mockResolvedValueOnce({
			data: { results: "albums" },
		});

		const result = await endpoint.getAlbums(10, 5);

		expect(axiosGet).toHaveBeenCalledWith(
			`${config.getBaseURL()}/v1/me/library/albums?limit=10&offset=5`,
		);
		expect(result).toEqual({ results: "albums" });
	});

	test("getPlaylists fetches from correct URL", async () => {
		const { instance: axiosInstance, get: axiosGet } = createAxiosInstance();
		mockGetAuthenticatedAxios.mockResolvedValueOnce(axiosInstance);
		const config = new AppleMusicConfig();
		const endpoint = new LibraryEndpoint(config);

		await endpoint.init();
		axiosGet.mockResolvedValueOnce({
			data: { results: "playlists" },
		});

		const result = await endpoint.getPlaylists(15, 2);

		expect(axiosGet).toHaveBeenCalledWith(
			`${config.getBaseURL()}/v1/me/library/playlists?limit=15&offset=2`,
		);
		expect(result).toEqual({ results: "playlists" });
	});

	test("getSongs fetches from correct URL", async () => {
		const { instance: axiosInstance, get: axiosGet } = createAxiosInstance();
		mockGetAuthenticatedAxios.mockResolvedValueOnce(axiosInstance);
		const config = new AppleMusicConfig();
		const endpoint = new LibraryEndpoint(config);

		await endpoint.init();
		axiosGet.mockResolvedValueOnce({
			data: { results: "songs" },
		});

		const result = await endpoint.getSongs();

		expect(axiosGet).toHaveBeenCalledWith(
			`${config.getBaseURL()}/v1/me/library/songs?limit=25&offset=0`,
		);
		expect(result).toEqual({ results: "songs" });
	});

	describe("playlists", () => {
		const playlist = (id: string) => ({ id, type: "library-playlists" });

		test("getAllPlaylists follows every page", async () => {
			const { endpoint, get, base } = await initEndpoint();
			get
				.mockResolvedValueOnce({
					data: {
						data: [playlist("p.1")],
						next: "/v1/me/library/playlists?offset=100",
						meta: { total: 2 },
					},
				})
				.mockResolvedValueOnce({ data: { data: [playlist("p.2")] } });

			const result = await endpoint.getAllPlaylists();

			expect(get).toHaveBeenNthCalledWith(
				1,
				`${base}/v1/me/library/playlists?limit=100&offset=0`,
			);
			expect(result).toEqual({
				items: [playlist("p.1"), playlist("p.2")],
				complete: true,
				total: 2,
			});
		});

		test("createPlaylist sends the name and returns the playlist", async () => {
			const { endpoint, post, base } = await initEndpoint();
			post.mockResolvedValueOnce({ data: { data: [playlist("p.new")] } });

			expect(await endpoint.createPlaylist("Mix", "desc")).toEqual(
				playlist("p.new"),
			);
			expect(post).toHaveBeenCalledWith(`${base}/v1/me/library/playlists`, {
				attributes: { name: "Mix", description: "desc" },
			});

			post.mockResolvedValueOnce({ data: { data: [playlist("p.2")] } });
			await endpoint.createPlaylist("Other");
			expect(post).toHaveBeenLastCalledWith(
				`${base}/v1/me/library/playlists`,
				{ attributes: { name: "Other" } },
			);
		});

		test("createPlaylist fails when Apple returns nothing", async () => {
			const { endpoint, post } = await initEndpoint();
			post.mockResolvedValueOnce({ data: {} });
			await expect(endpoint.createPlaylist("Mix")).rejects.toThrow(
				"did not return",
			);
		});

		test("getAllPlaylistTracks reads every page", async () => {
			const { endpoint, get, base } = await initEndpoint();
			get.mockResolvedValueOnce({ data: { data: [song("i.1")], meta: { total: 1 } } });

			const result = await endpoint.getAllPlaylistTracks("p.1");

			expect(get).toHaveBeenCalledWith(
				`${base}/v1/me/library/playlists/p.1/tracks?limit=100&offset=0`,
			);
			expect(result).toEqual({ items: [song("i.1")], complete: true, total: 1 });
		});

		test("getAllPlaylistTracks treats a 404 as an empty playlist", async () => {
			const { endpoint, get } = await initEndpoint();
			get.mockRejectedValueOnce({ response: { status: 404 } });
			expect(await endpoint.getAllPlaylistTracks("p.1")).toEqual({
				items: [],
				complete: true,
				total: 0,
			});
		});

		test("getAllPlaylistTracks rejects other failures", async () => {
			const { endpoint, get } = await initEndpoint();
			get.mockRejectedValueOnce({ response: { status: 500 } });
			await expect(endpoint.getAllPlaylistTracks("p.1")).rejects.toEqual({
				response: { status: 500 },
			});
		});

		test("addTracksToPlaylist sends catalog songs in batches", async () => {
			const { endpoint, post, base } = await initEndpoint();
			post.mockResolvedValue({ status: 204 });
			const ids = Array.from({ length: 51 }, (_, i) => String(i));

			await endpoint.addTracksToPlaylist("p.1", ids);

			expect(post).toHaveBeenCalledTimes(2);
			expect(post).toHaveBeenNthCalledWith(
				2,
				`${base}/v1/me/library/playlists/p.1/tracks`,
				{ data: [{ id: "50", type: "songs" }] },
			);
		});

		test("removeTracksFromPlaylist supports both strategies", async () => {
			const { endpoint, del, base } = await initEndpoint();
			del.mockResolvedValue({ status: 204 });
			const url = `${base}/v1/me/library/playlists/p.1/tracks`;

			await endpoint.removeTracksFromPlaylist("p.1", ["i.1", "i.2"], "query");
			expect(del).toHaveBeenLastCalledWith(
				`${url}?ids[library-songs]=i.1,i.2&mode=all`,
			);

			await endpoint.removeTracksFromPlaylist("p.1", ["i.1"], "body");
			expect(del).toHaveBeenLastCalledWith(url, {
				data: { data: [{ id: "i.1", type: "library-songs" }] },
			});
		});

		test("removeTracksFromPlaylist does nothing without ids", async () => {
			const { endpoint, del } = await initEndpoint();
			await endpoint.removeTracksFromPlaylist("p.1", [], "query");
			expect(del).not.toHaveBeenCalled();
		});
	});
});
