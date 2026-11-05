/**
 * Shared Axios clients and authentication token lifecycle management.
 *
 * @module Utilities/AxiosManager
 */
import axios, {
	type AxiosError,
	type AxiosInstance,
	type InternalAxiosRequestConfig,
} from "axios";
import { Cookie, CookieJar } from "tough-cookie";
import { AppleMusicConfig } from "./Config";
import { TokenStorage } from "./TokenStorage";

type RetryableRequest = InternalAxiosRequestConfig & {
	retryCount?: number;
	authRetried?: boolean;
};

const MAX_RETRY_DELAY_MS = 30_000;

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** @internal */
const isRetryable = (error: AxiosError): boolean => {
	const status = error.response?.status;
	if (status === undefined) return axios.isAxiosError(error);
	return status === 429 || status >= 500;
};

/** @internal */
const retryDelayMs = (
	error: AxiosError,
	attempt: number,
	baseDelayMs: number,
): number => {
	const retryAfter = Number(error.response?.headers?.["retry-after"]);
	const delay =
		Number.isFinite(retryAfter) && retryAfter > 0
			? retryAfter * 1000
			: baseDelayMs * 2 ** attempt;
	return Math.min(delay, MAX_RETRY_DELAY_MS);
};

/**
 * Internal coordinator that authenticates requests against Apple Music services.
 *
 * @category Utilities
 */
class AxiosManager {
	private cookiejar: CookieJar;
	private tokenAxios: AxiosInstance;
	private apiAxios: AxiosInstance | null = null;
	private tokenStorage: TokenStorage;
	private lastToken: string = "";
	private config: AppleMusicConfig;

	constructor(config: AppleMusicConfig = new AppleMusicConfig()) {
		this.config = config;
		this.cookiejar = new CookieJar();
		this.tokenAxios = this.createAxiosInstance();
		this.apiAxios = this.createAxiosInstance();
		this.tokenStorage = new TokenStorage(this.config, this.tokenAxios);
		this.addAuthInterceptor();
	}

	/** @internal */
	private createAxiosInstance(): AxiosInstance {
		const instance = axios.create({
			baseURL: "https://music.apple.com/",
			headers: {
				// yummy apple puter :D
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
				"Accept-Language": "en-US,en;q=0.5",
				Origin: "https://music.apple.com",
				Referer: "https://music.apple.com/",
			},
			withCredentials: true,
			timeout: 10000, // 10 seconds timeout
		});

		// Cookie interceptors
		instance.interceptors.request.use((req) => {
			if (req.baseURL) {
				const cookieString = this.cookiejar.getCookieStringSync(req.baseURL);
				if (cookieString) {
					req.headers.cookie = cookieString;
				}
			}
			return req;
		});

		instance.interceptors.response.use((res) => {
			if (res.headers && res.config.baseURL) {
				const cookieStrings = res.headers["set-cookie"] || [];
				for (const cookieString of cookieStrings) {
					const cookie = Cookie.parse(cookieString);
					if (cookie) {
						this.cookiejar.setCookieSync(cookie, res.config.baseURL);
					}
				}
			}
			return res;
		});

		return instance;
	}

	/** @internal */
	private addAuthInterceptor(): void {
		const client = this.apiAxios;
		client?.interceptors.request.use(async (req) => {
			// Only add auth for API requests to amp-api, not for token fetching on music.apple.com
			if (req.url?.includes("amp-api")) {
				// Endpoints keep this client for the life of the process, so the token
				// has to be checked here. getToken() returns the cached one while valid.
				const token = await this.tokenStorage.getToken();
				req.headers.Authorization = `Bearer ${token}`;
				if (this.config.userToken) {
					req.headers[this.config.userTokenHeader] = this.config.userToken;
				}
			}
			return req;
		});
		client?.interceptors.response.use(undefined, async (error: AxiosError) => {
			const req = error.config as RetryableRequest | undefined;
			if (!req) throw error;

			if (error.response?.status === 401 && !req.authRetried) {
				req.authRetried = true;
				this.tokenStorage.invalidate();
				return client.request(req);
			}

			const attempt = req.retryCount ?? 0;
			if (!isRetryable(error) || attempt >= this.config.maxRetries) throw error;

			req.retryCount = attempt + 1;
			await wait(retryDelayMs(error, attempt, this.config.retryBaseDelayMs));
			return client.request(req);
		});
	}

	/**
	 * Swap the configuration used for subsequent authenticated requests.
	 */
	public setConfig(config: AppleMusicConfig): void {
		if (this.config === config) {
			return;
		}
		this.config = config;
		this.tokenStorage = new TokenStorage(this.config, this.tokenAxios);
		this.lastToken = "";
	}

	/**
	 * Retrieve (and lazily refresh) the authenticated Axios instance.
	 */
	public async getInstance(): Promise<AxiosInstance> {
		const currentToken = await this.tokenStorage.getToken();
		if (currentToken !== this.lastToken) {
			// New token, create new instances with new cookie jar
			this.cookiejar = new CookieJar();
			this.tokenAxios = this.createAxiosInstance();
			this.apiAxios = this.createAxiosInstance();
			this.tokenStorage.axiosClient = this.tokenAxios;
			this.addAuthInterceptor();
			this.lastToken = currentToken;
		}
		return this.apiAxios;
	}
}

/** @internal */
const axiosManager = new AxiosManager();

export default axiosManager;
export { AxiosManager };

/**
 * Get an Axios instance that automatically authenticates against Apple Music.
 *
 * @param config - Optional configuration overrides for the shared client.
 * @returns A ready-to-use Axios instance with token storage wired up.
 */
export const getAuthenticatedAxios = async (
	config?: AppleMusicConfig,
): Promise<AxiosInstance> => {
	if (config) {
		axiosManager.setConfig(config);
	}
	return await axiosManager.getInstance();
};
