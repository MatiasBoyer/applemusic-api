/**
 * Primary entry point for `@syncfm/applemusic-api`.
 *
 * @packageDocumentation
 */

export { AppleMusic } from "./AppleMusic";
export { AlbumsEndpoint, AlbumsEndpointTypes } from "./endpoints/Albums";
export { ArtistsEndpoint, ArtistsEndpointTypes } from "./endpoints/Artists";
export { HintsEndpoint, HintsEndpointTypes } from "./endpoints/Hints";
export type {
	AllPagesResult,
	LibraryPage,
	LibraryPlaylist,
	LibrarySong,
	LibrarySongsResult,
	PlaylistRemoveStrategy,
} from "./endpoints/Library";
export {
	LibraryEndpoint,
	PLAYLIST_REMOVE_STRATEGIES,
} from "./endpoints/Library";
export {
	MusicVideosEndpoint,
	MusicVideosEndpointTypes,
} from "./endpoints/MusicVideos";
export { SearchEndpoint, SearchEndpointTypes } from "./endpoints/Search";
export { SongsEndpoint, SongsEndpointTypes } from "./endpoints/Songs";
export {
	SuggestionsEndpoint,
	SuggestionsEndpointTypes,
} from "./endpoints/Suggestions";
export { Region, ResourceType } from "./types/SharedSearchParams";
export { getAuthenticatedAxios } from "./utils/AxiosManager";
export type { AppleMusicConfigParams, UserTokenHeader } from "./utils/Config";
export { AppleMusicConfig, AuthType } from "./utils/Config";
export { DestinationName, Logger, LogLevel } from "./utils/Logger";
