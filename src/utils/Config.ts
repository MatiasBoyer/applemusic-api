/**
 * Configuration primitives for the Apple Music API client.
 *
 * @module Utilities/Config
 */
import { Region } from "../types/SharedSearchParams";
import { Logger, type LoggerOptions } from "./Logger";

/**
 * Authentication modes supported by the Apple Music API client.
 * @category Configuration
 */
export enum AuthType {
	Scraped,
	DeveloperToken,
	UserTokenViaDevToken,
	UserTokenUnofficial,
}

/**
 * Base URL mapping for each {@link AuthType}.
 * @category Configuration
 */
const BaseURLs: Record<AuthType, string> = {
	[AuthType.Scraped]: "https://amp-api-edge.music.apple.com",
	[AuthType.DeveloperToken]: "https://api.music.apple.com",
	[AuthType.UserTokenViaDevToken]: "https://api.music.apple.com",
	[AuthType.UserTokenUnofficial]: "https://amp-api-edge.music.apple.com",
};

/**
 * Headers Apple Music accepts for a user token.
 * @category Configuration
 */
export type UserTokenHeader = "Music-User-Token" | "media-user-token";

/**
 * Parameters accepted by {@link AppleMusicConfig}.
 * @category Configuration
 */
export type AppleMusicConfigParams = {
	region?: Region;
	authType?: AuthType;
	logger?: Logger;
	loggerOptions?: LoggerOptions;
	/** Apple Music user token, required by the Library endpoint. */
	userToken?: string;
	/** Header used to send {@link AppleMusicConfigParams.userToken}. */
	userTokenHeader?: UserTokenHeader;
	/** Overrides the API host for the selected {@link AuthType}. */
	baseURL?: string;
	/** Retries for rate limited or failed requests. Defaults to 3. */
	maxRetries?: number;
	/** First retry delay in milliseconds, doubled on each retry. Defaults to 1000. */
	retryBaseDelayMs?: number;
};

/**
 * Mutable configuration shared across endpoints for an {@link AppleMusic} client.
 * @category Configuration
 */
export class AppleMusicConfig {
	public region: Region = Region.US;
	public authType: AuthType = AuthType.Scraped;
	public logger: Logger;
	public loggerOptions?: LoggerOptions;
	public userToken?: string;
	public userTokenHeader: UserTokenHeader = "Music-User-Token";
	public baseURL?: string;
	public maxRetries = 3;
	public retryBaseDelayMs = 1000;

	constructor(config?: AppleMusicConfigParams) {
		if (config?.region) this.region = config.region;
		if (config?.authType) this.authType = config.authType;
		if (config?.loggerOptions) this.loggerOptions = config.loggerOptions;
		if (config?.userToken) this.userToken = config.userToken;
		if (config?.userTokenHeader) this.userTokenHeader = config.userTokenHeader;
		if (config?.baseURL) this.baseURL = config.baseURL;
		if (config?.maxRetries !== undefined) this.maxRetries = config.maxRetries;
		if (config?.retryBaseDelayMs !== undefined) {
			this.retryBaseDelayMs = config.retryBaseDelayMs;
		}
		if (config?.logger) {
			this.logger = config.logger;
		} else {
			this.logger = new Logger(this.loggerOptions);
		}
	}
	public setRegion(region: Region): void {
		this.region = region;
	}

	public setAuthType(authType: AuthType): void {
		this.authType = authType;
	}

	public setLoggerOptions(options: LoggerOptions): void {
		this.loggerOptions = options;
		this.logger = new Logger(options);
	}

	public setLogger(logger: Logger): void {
		this.logger = logger;
	}

	public setUserToken(token: string): void {
		this.userToken = token;
	}

	public getBaseURL(): string {
		return this.baseURL ?? BaseURLs[this.authType];
	}

	public getBaseURLForAuthType(authType: AuthType): string {
		switch (authType) {
			case AuthType.Scraped:
				return BaseURLs[AuthType.Scraped];
			case AuthType.DeveloperToken:
				return BaseURLs[AuthType.DeveloperToken];
			case AuthType.UserTokenViaDevToken:
				return BaseURLs[AuthType.UserTokenViaDevToken];
			case AuthType.UserTokenUnofficial:
				return BaseURLs[AuthType.UserTokenUnofficial];
			default:
				throw new Error("Invalid AuthType");
		}
	}
}
