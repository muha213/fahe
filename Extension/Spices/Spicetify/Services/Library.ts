// Imported Types
import type PlaylistMetadata from "../Types/App/PlaylistMetadata.ts"
import type PlaylistItemMetadata from "../Types/App/PlaylistItemMetadata.ts"

// Spicetify Services
import { SpotifyPlatform } from "./Session.ts"

// Playlist Retrieval (Simplified data to encourage active fetching of data)
const PlaylistSortOrders = {
	Alphabetical: "0",
	RecentlyAdded: "1",
	Creator: "2",
	CustomOrder: "4",
	Recents: "6",
}
type PlaylistSortOrder = keyof typeof PlaylistSortOrders

type CollectedFolder = {
	Type: "Folder",
	Uri: string,
	Name: string
}
type CollectedPlaylist = {
	Type: "Playlist",
	Uri: string,
	CanAddTo: boolean
}
type CollectedItem = (CollectedPlaylist | CollectedFolder)
export const GetPlaylistsAndFolders = (
	sortOrder: PlaylistSortOrder = "Recents", fromFolderUri: string = "",
	textFilter: string = ""
): Promise<CollectedItem[]> => {
	if (!SpotifyPlatform?.LibraryAPI?.getContents) {
		return Promise.resolve([])
	}
	return (
		SpotifyPlatform.LibraryAPI.getContents(
			{
				offset: 0,
				limit: 10000, // Spotify limit
				filters: ["2"],
				sortOrder: PlaylistSortOrders[sortOrder],
				textFilter,
				includeLocalFiles: false,
				includeYourEpisodes: false,
				includeLikedSongs: false,
				includePreReleases: false,
				filtersPickedByUser: false,
				folderUri: fromFolderUri
			}
		)
		.then(
			(
				result: {
					items?: (
						PlaylistMetadata
						| { type: "folder", uri: string, name: string }
					)[]
				}
			) => {
				const basket: CollectedItem[] = []
				for (const item of (result?.items ?? [])) {
					if (item.type === "playlist") {
						basket.push(
							{
								Type: "Playlist",
								Uri: item.uri,
								CanAddTo: (item as unknown as { canAddTo: boolean }).canAddTo
							}
						)
					} else if (item.type === "folder") {
						basket.push(
							{
								Type: "Folder",
								Uri: item.uri,
								Name: item.name
							}
						)
					}
				}
				return basket
			}
		)
		.catch(() => [])
	)
}

// Playlist Information Functions
type PlaylistContentsResponse = {
	totalLength: number;
	limit: number;
	items: PlaylistItemMetadata[];
	offset: number; // I have no idea what this is used for, doesn't seem like Spotify uses pagination?
}
type PlaylistContents = {
	ItemCount: number;
	Items: PlaylistItemMetadata[];
}

export const GetPlaylistDetails = (playlistUri: string): Promise<PlaylistMetadata> => {
	if (!SpotifyPlatform?.PlaylistAPI?.getMetadata) {
		return Promise.reject("PlaylistAPI not available")
	}
	return SpotifyPlatform.PlaylistAPI.getMetadata(playlistUri)
}

export const GetPlaylistContents = (playlistUri: string): Promise<PlaylistContents> => {
	if (!SpotifyPlatform?.PlaylistAPI?.getContents) {
		return Promise.resolve({ ItemCount: 0, Items: [] })
	}
	return (
		SpotifyPlatform.PlaylistAPI.getContents(playlistUri)
		.then((contents: PlaylistContentsResponse) => ({ ItemCount: contents?.totalLength ?? 0, Items: contents?.items ?? [] }))
		.catch(() => ({ ItemCount: 0, Items: [] }))
	)
}

// Playlist Modification Functions
export const AddToPlaylist = (playlistUri: string, trackUris: string[]): Promise<void> => {
	if (!SpotifyPlatform?.PlaylistAPI?.add) return Promise.resolve()
	return SpotifyPlatform.PlaylistAPI.add(playlistUri, trackUris, { after: "end" })
}
export const RemoveFromPlaylist = (playlistUri: string, tracks: { uri: string, uid: string }[]): Promise<void> => {
	if (!SpotifyPlatform?.PlaylistAPI?.remove) return Promise.resolve()
	return SpotifyPlatform.PlaylistAPI.remove(playlistUri, tracks)
}

// Creation Functions
export const CreateFolder = (name: string, parentFolderUri?: string): Promise<string> => {
	if (!SpotifyPlatform?.RootlistAPI?.createFolder) return Promise.resolve("")
	return (
		SpotifyPlatform.RootlistAPI.createFolder(
			name,
			(
				(parentFolderUri !== undefined) ? { after: { uri: parentFolderUri } }
				: undefined
			)
		).then((result: { uri: string }) => result?.uri ?? "")
	)
}
export const CreatePlaylist = (name: string, parentFolderUri?: string): Promise<string> => {
	if (!SpotifyPlatform?.RootlistAPI?.createPlaylist) return Promise.resolve("")
	return (
		SpotifyPlatform.RootlistAPI.createPlaylist(
			name,
			(
				(parentFolderUri !== undefined) ? { after: { uri: parentFolderUri } }
				: undefined
			)
		)
	)
}