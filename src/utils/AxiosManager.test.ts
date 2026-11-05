import { AxiosError, type AxiosInstance } from "axios";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AxiosManager, getAuthenticatedAxios } from "./AxiosManager";
import { AppleMusicConfig } from "./Config";

const { getTokenMock, setAxiosClientMock, invalidateMock } = vi.hoisted(() => {
	return {
		invalidateMock: vi.fn(),
		getTokenMock: vi.fn<() => Promise<string>>(async () => ""),
		setAxiosClientMock: vi.fn<(client: AxiosInstance) => void>(),
	};
});

vi.mock("./TokenStorage", () => {
	return {
		TokenStorage: class {
			public currentToken = "";
			private _axiosClient: AxiosInstance;

			constructor(_: unknown, axiosClient: AxiosInstance) {
				this._axiosClient = axiosClient;
				setAxiosClientMock(axiosClient);
			}

			set axiosClient(client: AxiosInstance) {
				this._axiosClient = client;
				setAxiosClientMock(client);
			}

			get axiosClient(): AxiosInstance {
				return this._axiosClient;
			}

			async getToken(): Promise<string> {
				const token = await getTokenMock();
				this.currentToken = token;
				return token;
			}

			invalidate(): void {
				invalidateMock();
			}
		},
	};
});

const runRequestInterceptors = async (instance: AxiosInstance, config: any) => {
	const handlers = (instance.interceptors.request as any).handlers.filter(
		Boolean,
	);
	let currentConfig = config;
	for (const handler of handlers) {
		if (typeof handler.fulfilled === "function") {
			currentConfig = await handler.fulfilled(currentConfig);
		}
	}
	return currentConfig;
};

const runResponseInterceptors = async (
	instance: AxiosInstance,
	response: any,
) => {
	const handlers = (instance.interceptors.response as any).handlers.filter(
		Boolean,
	);
	let currentResponse = response;
	for (const handler of handlers) {
		if (typeof handler.fulfilled === "function") {
			currentResponse = await handler.fulfilled(currentResponse);
		}
	}
	return currentResponse;
};

describe("AxiosManager", () => {
	let axiosManager: AxiosManager;

	beforeEach(() => {
		getTokenMock.mockReset();
		setAxiosClientMock.mockReset();
		axiosManager = new AxiosManager();
	});

	test("getInstance returns configured Axios instance and caches token", async () => {
		getTokenMock.mockResolvedValue("token-a");

		const instance = await axiosManager.getInstance();

		expect(instance.defaults.baseURL).toBe("https://music.apple.com/");
		expect((axiosManager as any).lastToken).toBe("token-a");
		expect((axiosManager as any).tokenStorage.currentToken).toBe("token-a");
	});

	test("reuses existing Axios instance when token is unchanged", async () => {
		getTokenMock.mockResolvedValue("token-static");

		const baselineCalls = setAxiosClientMock.mock.calls.length;
		const firstInstance = await axiosManager.getInstance();
		const afterFirstCalls = setAxiosClientMock.mock.calls.length;
		const secondInstance = await axiosManager.getInstance();
		const afterSecondCalls = setAxiosClientMock.mock.calls.length;

		expect(secondInstance).toBe(firstInstance);
		expect(afterFirstCalls).toBeGreaterThan(baselineCalls);
		expect(afterSecondCalls).toBe(afterFirstCalls);
	});

	test("refreshes Axios instance and cookie jar when token changes", async () => {
		getTokenMock
			.mockResolvedValueOnce("token-1")
			.mockResolvedValueOnce("token-2");

		const baselineCalls = setAxiosClientMock.mock.calls.length;
		const firstInstance = await axiosManager.getInstance();
		const firstCookieJar = (axiosManager as any).cookiejar;
		const afterFirstCalls = setAxiosClientMock.mock.calls.length;

		expect((axiosManager as any).lastToken).toBe("token-1");

		const secondInstance = await axiosManager.getInstance();
		const secondCookieJar = (axiosManager as any).cookiejar;
		const afterSecondCalls = setAxiosClientMock.mock.calls.length;

		expect(secondInstance).not.toBe(firstInstance);
		expect(secondCookieJar).not.toBe(firstCookieJar);
		expect((axiosManager as any).lastToken).toBe("token-2");
		expect(afterFirstCalls).toBeGreaterThan(baselineCalls);
		expect(afterSecondCalls).toBeGreaterThan(afterFirstCalls);
	});

	test("auth interceptor adds Authorization header for amp-api requests", async () => {
		getTokenMock.mockResolvedValue("token-auth");

		const instance = await axiosManager.getInstance();
		const config = await runRequestInterceptors(instance, {
			url: "https://amp-api.music.apple.com/v1/catalog/us/albums/1",
			headers: {},
		});

		expect(config.headers.Authorization).toBe("Bearer token-auth");
	});

	test("auth interceptor skips non amp-api requests", async () => {
		getTokenMock.mockResolvedValue("token-auth");

		const instance = await axiosManager.getInstance();
		const config = await runRequestInterceptors(instance, {
			url: "https://music.apple.com/us/album",
			headers: {},
		});

		expect(config.headers.Authorization).toBeUndefined();
	});

	test("cookie interceptors attach existing cookies and persist new ones", async () => {
		getTokenMock.mockResolvedValue("token-cookie");

		const instance = await axiosManager.getInstance();
		const jar = (axiosManager as any).cookiejar;

		jar.setCookieSync("existing=1", "https://example.com");

		const requestConfig = await runRequestInterceptors(instance, {
			baseURL: "https://example.com",
			url: "/albums",
			headers: {},
		});

		expect(requestConfig.headers.cookie).toBe("existing=1");

		await runResponseInterceptors(instance, {
			config: { baseURL: "https://example.com" },
			headers: { "set-cookie": ["fresh=2"] },
		});

		const storedCookies = jar
			.getCookieStringSync("https://example.com")
			.split("; ")
			.sort();
		expect(storedCookies).toEqual(["existing=1", "fresh=2"].sort());
	});

	test("getAuthenticatedAxios delegates to shared AxiosManager", async () => {
		getTokenMock.mockResolvedValue("token-shared");

		const [sharedInstance, standaloneInstance] = await Promise.all([
			getAuthenticatedAxios(),
			axiosManager.getInstance(),
		]);

		expect(sharedInstance.defaults.baseURL).toBe("https://music.apple.com/");
		expect(sharedInstance).not.toBe(standaloneInstance);
		expect(getTokenMock).toHaveBeenCalledTimes(2);
	});

	describe("long running requests", () => {
		const url = "https://amp-api-edge.music.apple.com/v1/me/library/songs";

		const setup = async (
			adapter: (config: any) => Promise<any>,
			config: Record<string, unknown> = {},
		) => {
			getTokenMock.mockResolvedValue("dev-token");
			const manager = new AxiosManager(
				new AppleMusicConfig({ maxRetries: 2, retryBaseDelayMs: 0, ...config }),
			);
			const client = await manager.getInstance();
			client.defaults.adapter = adapter;
			return client;
		};

		const response = (config: any, status: number, headers = {}) => {
			const res = { status, data: {}, headers, config, statusText: "", request: {} };
			if (status < 400) return Promise.resolve(res);
			const error: any = new AxiosError("failed", undefined, config, {}, res);
			return Promise.reject(error);
		};

		beforeEach(() => {
			getTokenMock.mockReset();
			invalidateMock.mockReset();
		});

		test("checks the token on every request and sends the user token", async () => {
			const adapter = vi.fn((config: any) => response(config, 200));
			const client = await setup(adapter, { userToken: "user-token" });
			getTokenMock.mockClear();
			getTokenMock.mockResolvedValueOnce("first").mockResolvedValueOnce("renewed");

			await client.get(url);
			await client.get(url);

			expect(getTokenMock).toHaveBeenCalledTimes(2);
			const headers = adapter.mock.calls[1][0].headers;
			expect(headers.Authorization).toBe("Bearer renewed");
			expect(headers["Music-User-Token"]).toBe("user-token");
		});

		test("sends the user token in the configured header", async () => {
			const adapter = vi.fn((config: any) => response(config, 200));
			const client = await setup(adapter, {
				userToken: "user-token",
				userTokenHeader: "media-user-token",
			});

			await client.get(url);

			expect(adapter.mock.calls[0][0].headers["media-user-token"]).toBe(
				"user-token",
			);
		});

		test.each([429, 503])("retries a %i response", async (status) => {
			const adapter = vi
				.fn((config: any) => response(config, 200))
				.mockImplementationOnce((config: any) => response(config, status));
			const client = await setup(adapter);

			await expect(client.get(url)).resolves.toMatchObject({ status: 200 });
			expect(adapter).toHaveBeenCalledTimes(2);
		});

		test("stops after the configured retries", async () => {
			const adapter = vi.fn((config: any) => response(config, 503));
			const client = await setup(adapter);

			await expect(client.get(url)).rejects.toThrow("failed");
			expect(adapter).toHaveBeenCalledTimes(3);
		});

		test("does not retry other client errors", async () => {
			const adapter = vi.fn((config: any) => response(config, 404));
			const client = await setup(adapter);

			await expect(client.get(url)).rejects.toThrow("failed");
			expect(adapter).toHaveBeenCalledTimes(1);
		});

		test("renews the token once on a 401", async () => {
			const adapter = vi.fn((config: any) => response(config, 401));
			const client = await setup(adapter);

			await expect(client.get(url)).rejects.toThrow("failed");
			expect(invalidateMock).toHaveBeenCalledTimes(1);
			expect(adapter).toHaveBeenCalledTimes(2);
		});
	});
});
