// Spotify Types
import type { TrackInformationResponse, TrackInformation, TrackReleaseDate } from "../../Types/API/InternalTrackInformation.ts"
import type TrackMetadata from "../../Types/App/TrackMetadata.ts"

// Web-Modules
import { Signal, type Event } from "@Universal/Modules/Signal.ts"
import { Maid } from "@Universal/Modules/Maid.ts"
import { Defer, Timeout } from "@Universal/Modules/Scheduler.ts"

// Spicetify Services
import {
	GlobalMaid,
	OnSpotifyReady,
	SpotifyPlayer, SpotifyPlatform, SpotifyURI, SpotifyRequestBuilder,
	SpotifyInternalFetch, SpotifyFetch,
	GetSpotifyAccessToken
} from "../Session.ts"
import { GetExpireStore, GetDynamicStoreItem, SetDynamicStoreItem } from '../Cache.ts'



// Our Modules
import {
	TransformProviderLyrics, SetRomanizationSeparator,
	type ProviderLyrics, type TransformedLyrics, type RomanizedLanguage
} from "./LyricUtilities.ts"

// Lyric Providers (fallback chain)
import {
	FetchLRCLIBLyrics, FetchLRCLIBByISRC, FetchDirectSpotifyLyrics,
	FetchLyricsOvh,
	FetchBetterLyricsUnison, FetchBetterLyricsUnisonLine,
	FetchBiniLyrics, FetchBiniLyricsLine,
	FetchMusixmatchLyrics, FetchMusixmatchSearchLyrics,
	FetchAMLLDBLyrics, FetchGeniusLyrics, FetchDeezerLyrics, FetchYouTubeLyrics,
	FetchNeteaseLyrics, FetchQQMusicLyrics, FetchKugouLyrics,
	FetchBetterLyricsTTML, FetchBetterLyricsKugou, FetchBetterLyricsLegacy, FetchBetterLyricsQQ,
	FetchTxwLyrics
} from "./Providers.ts"

// Re-export some useful types
export type { RomanizedLanguage, TransformedLyrics }

// Create our maid for the Player
const PlayerMaid = GlobalMaid.Give(new Maid())

// Create our signals/expose events
type TimeStepped = (deltaTime: number, skipped?: true) => void
const [
	SongChangedSignal, SongContextChangedSignal,
	SongDetailsLoadedSignal, SongLyricsLoadedSignal,
	IsPlayingChangedSignal, TimeSteppedSignal,
	IsShufflingChangedSignal, LoopModeChangedSignal,
	IsLikedChangedSignal
] = PlayerMaid.GiveItems(
	new Signal(), new Signal(),
	new Signal(), new Signal(),
	new Signal(), new Signal<TimeStepped>(),
	new Signal(), new Signal(),
	new Signal()
)
export const SongChanged: Event = SongChangedSignal.GetEvent()
export const SongContextChanged: Event = SongContextChangedSignal.GetEvent()
export const SongDetailsLoaded: Event = SongDetailsLoadedSignal.GetEvent()
export const SongLyricsLoaded: Event = SongLyricsLoadedSignal.GetEvent()
export const IsPlayingChanged: Event = IsPlayingChangedSignal.GetEvent()
export const TimeStepped: Event<TimeStepped> = TimeSteppedSignal.GetEvent()
export const IsShufflingChanged: Event = IsShufflingChangedSignal.GetEvent()
export const LoopModeChanged: Event = LoopModeChangedSignal.GetEvent()
export const IsLikedChanged: Event = IsLikedChangedSignal.GetEvent()

// Store our song state
export type DJMetadata = {
	Type: "DJ";

	Uri: string;
	Action: string;
	CoverArt: {
		Large: string;
		Big: string;
		Default: string;
		Small: string;
	};
}
export type LocalSongMetadata = {
	Type: "Local";

	Uri: string;
	Duration: number;
	CoverArt?: string;
}
export type StreamedSongMetadata = {
	Type: "Streamed";

	Uri: string;
	Id: string;
	InternalId: string;
	Duration: number;
	CoverArt: {
		Large: string;
		Big: string;
		Default: string;
		Small: string;
	};
}
export type SongMetadata = (StreamedSongMetadata | LocalSongMetadata | DJMetadata)
export let Song: (SongMetadata | undefined) = undefined

export type SongContextDetails = (
	{
		Uri: string;
		Description: string;
		CoverArt?: string;
	}
	& (
		{
			Type: "Album",
			Id: string
		}
		| {
			Type: "Playlist",
			Id: string
		}
		| {
			Type: "LocalFiles"
		}
		| {
			Type: "Other"
		}
	)
)
export let SongContext: (SongContextDetails | undefined) = undefined

export let IsLiked = false
export let HasIsLikedLoaded = false

// Static Song Helpers
export const SetIsLiked = (isLiked: boolean): (false | void) => ((isLiked !== IsLiked) && SpotifyPlayer.setHeart(isLiked))
export const GetDurationString = (): string => {
	if (Song?.Type === "DJ") {
		throw new Error("Cannot get duration of a DJ track")
	}

	const duration = (Song?.Duration ?? 0)
	const minutes = Math.floor(duration / 60)
	const seconds = Math.floor(duration % 60)
	return `${(duration >= 600) ? minutes.toString().padStart(2, "0") : minutes}:${seconds.toString().padStart(2, "0")}`
}

// Store our Playback state
export let Timestamp: number = -1
export let IsPlaying: boolean = false
export let IsShuffling: boolean = false
type LoopModeOption = ("Off" | "Song" | "Context")
export let LoopMode: LoopModeOption = "Off"

// Static Playback Helpers
export const SetLoopMode = (loopMode: LoopModeOption): void => (
	SpotifyPlayer.setRepeat(
		(loopMode === "Off") ? 0
		: (loopMode === "Context") ? 1 : 2
	)
)
export const SetIsShuffling = (isShuffling: boolean): void => SpotifyPlayer.setShuffle(isShuffling)
export const SetIsPlaying = (isPlaying: boolean): (false | void) => (
	(isPlaying !== IsPlaying)
	&& (isPlaying ? SpotifyPlayer.play() : SpotifyPlayer.pause())
)
export const SeekTo = (timestamp: number): void => {
	Timestamp = Math.max(0, timestamp)
	try {
		SpotifyPlayer?.seek?.(timestamp * 1000)
	} catch (_) {}
	TimeSteppedSignal.Fire(0, true)
}
export const GetTimestampString = (): string => {
	if (Song?.Type === "DJ") {
		throw new Error("Cannot get Timestamp of a DJ track")
	}

	const duration = (Song?.Duration ?? 0)
	const minutes = Math.floor(Timestamp / 60)
	const seconds = Math.floor(Timestamp % 60)
	return `${(duration >= 600) ? minutes.toString().padStart(2, "0") : minutes}:${seconds.toString().padStart(2, "0")}`
}

// Handle our Details
export type LocalSongDetails = {
	IsLocal: true;

	Name: string;
	Album: string;
	Artists?: string[];
}
type StreamedArtistsDetails = {
	InternalId: string;
	Id: string;
	Name: string;
}
export type StreamedSongDetails = {
	IsLocal: false;

	ISRC: string;
	Name: string;
	Artists: StreamedArtistsDetails[];
	Album: {
		InternalId: string;
		Id: string;
		Artists: StreamedArtistsDetails[];
		ReleaseDate: TrackReleaseDate;
	};

	Raw: TrackInformation;
}
export type LoadedSongDetails = (LocalSongDetails | StreamedSongDetails)
export let SongDetails: (LoadedSongDetails | undefined) = undefined
export let HaveSongDetailsLoaded: boolean = false

const TrackInformationStore = GetExpireStore<TrackInformation>(
	"Player_TrackInformation", 2,
	{
		Duration: 2,
		Unit: "Weeks"
	},
	true
)
const SongNameFilters = [
	/\s*(?:\-|\/)\s*(?:(?:Stereo|Mono)\s*)?Remastered(?:\s*\d+)?/,
	/\s*\-\s*(?:Stereo|Mono)(?:\s*Version|\s*Mix)?/,
	/\s*\(\s*(?:Stereo|Mono)(?:\s*Mix)?\)?/
]
const LoadSongDetails = () => {
	// Remove our prior details state
	SongDetails = undefined, HaveSongDetailsLoaded = false

	// If we have no song then we have no details
	const songAtUpdate = Song
	if ((songAtUpdate === undefined) || (songAtUpdate.Type === "DJ")) {
		HaveSongDetailsLoaded = true
		SongDetailsLoadedSignal.Fire()
		return
	}

	// If we're a local song, as of now, there will be no details stored
	if (songAtUpdate.Type === "Local") {
		SongDetails = {
			IsLocal: true,

			Name: SpotifyPlayer.data.item.name,
			Album: SpotifyPlayer.data.item.album.name,
			Artists: SpotifyPlayer.data.item.artists?.map(artist => artist.name)
		}, HaveSongDetailsLoaded = true
		SongDetailsLoadedSignal.Fire()

		return
	}

	// Otherwise, fetch our details
	{
		TrackInformationStore.GetItem(songAtUpdate.Id)
		.then(
			trackInformation => {
				if (trackInformation === undefined) {
					let fetchPromise: Promise<TrackInformationResponse | { ok: boolean, body: TrackInformation }>
					if (SpotifyRequestBuilder !== undefined) {
						const requestBuilder = (
							SpotifyRequestBuilder.build()
							.withHost("https://spclient.wg.spotify.com/metadata/4")
							.withPath(`/track/${songAtUpdate.InternalId}`)
							.withEndpointIdentifier(`/track/${songAtUpdate.InternalId}`)
						)
						requestBuilder.UseExistingPromise = true
						fetchPromise = requestBuilder.send() as Promise<TrackInformationResponse>
					} else if (SpotifyInternalFetch !== undefined) {
						fetchPromise = (SpotifyInternalFetch.get(`https://spclient.wg.spotify.com/metadata/4/track/${songAtUpdate.InternalId}`) as Promise<any>).then(body => ({ ok: true, body }))
					} else {
						fetchPromise = SpotifyFetch(`https://spclient.wg.spotify.com/metadata/4/track/${songAtUpdate.InternalId}`).then(async (r: Response) => ({ ok: r.ok, body: await r.json() }))
					}

					return (
						fetchPromise
						.catch(error => { console.warn(error); throw error })
						.then(
							response => {
								if (response.ok === false) {
									throw `Failed to load Track (${songAtUpdate.Id}) Information`
								}
								return response.body
							}
						)
						.then(
							(trackInfo) => {
								TrackInformationStore.SetItem(songAtUpdate.Id, trackInfo)
								return trackInfo
							}
						)
					)
				} else {
					return trackInformation
				}
			}
		)
		.then(
			trackInformation => {
				// Make sure we still have the same song active
				if (Song !== songAtUpdate) {
					return
				}

				// Filter our name of any gunk we may not want
				let transformedName = trackInformation.name
				for (const filter of SongNameFilters) {
					transformedName = transformedName.replace(filter, "")
				}

				// Update our details
				SongDetails = {
					IsLocal: false,

					ISRC: trackInformation.external_id?.find((entry: any) => entry.type === "isrc")?.id ?? "",
					Name: transformedName,
					Artists: (trackInformation.artist ?? []).map(
						(artist: any) => (
							{
								InternalId: artist.gid,
								Id: SpotifyURI.hexToId(artist.gid),
								Name: artist.name
							}
						)
					),
					Album: {
						InternalId: trackInformation.album?.gid ?? "",
						Id: SpotifyURI.hexToId(trackInformation.album?.gid ?? ""),
						Artists: (trackInformation.album?.artist ?? []).map(
							(artist: any) => (
								{
									InternalId: artist.gid,
									Id: SpotifyURI.hexToId(artist.gid),
									Name: artist.name
								}
							)
						),
						ReleaseDate: trackInformation.album?.date ?? { year: 0 }
					},

					Raw: trackInformation
				}, HaveSongDetailsLoaded = true
				SongDetailsLoadedSignal.Fire()
			}
		)
		.catch(error => {
			console.warn("Beautiful Lyrics: Failed to fetch metadata, falling back to basic track info", error)
			const item = SpotifyPlayer.data?.item
			if (item === undefined || Song !== songAtUpdate) return
			const artists = (item.artists ?? []).map((a: any) => ({
				InternalId: SpotifyURI.idToHex(SpotifyURI.from(a.uri)?.id ?? ""),
				Id: SpotifyURI.from(a.uri)?.id ?? "",
				Name: a.name
			}))
			SongDetails = {
				IsLocal: false,
				ISRC: "",
				Name: FilterSongName(item.name),
				Artists: artists,
				Album: {
					InternalId: SpotifyURI.idToHex(SpotifyURI.from(item.album?.uri)?.id ?? ""),
					Id: SpotifyURI.from(item.album?.uri)?.id ?? "",
					Artists: artists,
					ReleaseDate: { year: 0 }
				},
				Raw: undefined as unknown as TrackInformation
			}
			HaveSongDetailsLoaded = true
			SongDetailsLoadedSignal.Fire()
		})
	}
}

// Handle our Lyrics
const ProviderLyricsStore = GetExpireStore<ProviderLyrics | false>(
	"Player_ProviderLyrics", 3,
	{
		Duration: 1,
		Unit: "Months"
	},
	true
)
const TransformedLyricsStore = GetExpireStore<TransformedLyrics | false>(
	"Player_TransformedLyrics", 3,
	{
		Duration: 1,
		Unit: "Months"
	},
	true
)

const FilterSongName = (songName: string): string => {
	let transformedName = songName
	for (const filter of SongNameFilters) {
		transformedName = transformedName.replace(filter, "")
	}
	return transformedName
}

// Fallback providers toggle
const FallbackProvidersKey = "UseFallbackProviders"
export const GetUseFallbackProviders = (): boolean => (
	GetDynamicStoreItem<boolean>("BeautifulLyrics", FallbackProvidersKey) ?? true
)
export const SetUseFallbackProviders = (enabled: boolean): void => {
	SetDynamicStoreItem("BeautifulLyrics", FallbackProvidersKey, String(enabled))
}

// Provider selection
const SelectedProviderKey = "SelectedProvider"
export const GetSelectedProvider = (): string => (
	GetDynamicStoreItem<string>("BeautifulLyrics", SelectedProviderKey) ?? "auto"
)
export const SetSelectedProvider = (provider: string): void => {
	SetDynamicStoreItem("BeautifulLyrics", SelectedProviderKey, provider)
}

export let SongLyrics: (TransformedLyrics | undefined) = undefined
export let HaveSongLyricsLoaded: boolean = false
const ResolveAppleMusicId = (trackName: string, artistName?: string, duration?: number): Promise<{ id: string; title: string } | undefined> => {
	if (!trackName || trackName.length === 0) return Promise.resolve(undefined)
	const searchUrl = new URL("https://itunes.apple.com/search")
	searchUrl.searchParams.set("term", `${trackName} ${artistName ?? ""}`.trim())
	searchUrl.searchParams.set("media", "music")
	searchUrl.searchParams.set("entity", "song")
	searchUrl.searchParams.set("limit", "10")

	const controller = new AbortController()
	const timeout = globalThis.setTimeout(() => controller.abort(), 3000)
	return fetch(searchUrl.toString(), { signal: controller.signal })
		.then(response => (!response.ok ? undefined : response.json()))
		.then((payload?: { results?: { trackId?: number; trackName?: string; trackTimeMillis?: number }[] }) => {
			const results = Array.isArray(payload?.results) ? payload.results : []
			const lowerTrackName = trackName.toLowerCase()
			const matched = results.find(result => {
				if (result.trackId === undefined || result.trackName === undefined) return false
				const resultTrackName = result.trackName.toLowerCase()
				return (
					(resultTrackName.includes(lowerTrackName) || lowerTrackName.includes(resultTrackName)) &&
					(!Number.isFinite(duration) || (duration ?? 0) <= 0 || result.trackTimeMillis === undefined || Math.abs((result.trackTimeMillis / 1000) - (duration ?? 0)) <= 5)
				)
			})
			return matched?.trackId !== undefined && matched.trackName !== undefined
				? { id: String(matched.trackId), title: matched.trackName }
				: undefined
		})
		.catch(() => undefined)
		.finally(() => globalThis.clearTimeout(timeout))
}

const BuildLyricsRequestURL = async (song: StreamedSongMetadata): Promise<string> => {
	const url = new URL(`https://lyrics.txw.qzz.io/lyrics/${encodeURIComponent(song.Id)}`)
	const track = SpotifyPlayer.data?.item
	const metadata = track?.metadata as unknown as (TrackMetadata | undefined)

	const trackName = metadata?.title || track?.name
	if (trackName !== undefined && trackName.length > 0) {
		url.searchParams.set("track_name", FilterSongName(trackName))
	}

	const artistNames = (
		track?.artists
		?.map(artist => artist.name)
		.filter((artistName): artistName is string => artistName !== undefined && artistName.length > 0)
		?? []
	)
	if ((artistNames.length === 0) && (metadata?.artist_name !== undefined) && (metadata.artist_name.length > 0)) {
		artistNames.push(metadata.artist_name)
	}
	for (const artistName of artistNames) {
		url.searchParams.append("artist_name", artistName)
	}

	const albumName = metadata?.album_title || track?.album?.name
	if (albumName !== undefined && albumName.length > 0) {
		url.searchParams.set("album_name", albumName)
	}

	if (Number.isFinite(song.Duration) && song.Duration > 0) {
		url.searchParams.set("duration", String(Math.round(song.Duration)))
	}

	// Attach ISRC if available from cached track info
	try {
		const trackInfo = await TrackInformationStore.GetItem(song.Id)
		const isrc = trackInfo?.external_id?.find((e: any) => e.type === "isrc")?.id
		if (isrc !== undefined && isrc.length > 0) {
			url.searchParams.set("isrc", isrc)
		}
	} catch { /* cache miss, proceed without ISRC */ }

	// Attach Apple Music ID if resolvable client-side
	try {
		if (trackName !== undefined && trackName.length > 0) {
			const appleMusic = await ResolveAppleMusicId(trackName, artistNames[0], song.Duration)
			if (appleMusic) {
				url.searchParams.set("apple_id", appleMusic.id)
				url.searchParams.set("apple_title", appleMusic.title)
			}
		}
	} catch { /* proceed without apple_id */ }

	return url.toString()
}
const parseArtistNamesAndFetch = (
	fetchFn: (artist: string, title: string, duration?: number) => Promise<ProviderLyrics | undefined>,
	rawArtist: string,
	title: string,
	duration?: number
): Promise<ProviderLyrics | undefined> => {
	const artists = rawArtist.split(/\s*[,;&]|(?:\s+feat[.])/i).map(a => a.trim()).filter(a => a.length > 0)
	if (artists.length === 0) return fetchFn(rawArtist, title, duration)
	return fetchAllArtists(fetchFn, artists, title, duration)
}

const fetchAllArtists = (
	fetchFn: (artist: string, title: string, duration?: number) => Promise<ProviderLyrics | undefined>,
	artists: string[],
	title: string,
	duration?: number
): Promise<ProviderLyrics | undefined> => {
	if (artists.length === 0) return Promise.resolve(undefined)
	const primary = artists[0]
	return fetchFn(primary, title, duration).then(result => {
		if (result !== undefined) return result
		if (artists.length > 1) return fetchFn(artists[1], title, duration)
		return undefined
	})
}

const FetchProviderWithMeta = (fetchFn: (artist: string, title: string, duration?: number) => Promise<ProviderLyrics | undefined>, duration?: number): Promise<ProviderLyrics | undefined> => {
	const meta = SpotifyPlayer.data?.item?.metadata as unknown as (TrackMetadata | undefined)
	const track = SpotifyPlayer.data?.item
	const rawTitle = meta?.title ?? track?.name
	if (rawTitle === undefined || rawTitle.length === 0) return Promise.resolve(undefined)
	const title = FilterSongName(rawTitle)
	const artistNames = (
		track?.artists
		?.map(artist => artist.name)
		.filter((artistName): artistName is string => artistName !== undefined && artistName.length > 0)
		?? []
	)
	if (artistNames.length === 0) {
		const artist = meta?.artist_name
		if (artist === undefined || artist.length === 0) return Promise.resolve(undefined)
		return parseArtistNamesAndFetch(fetchFn, artist, title, duration)
	}
	return fetchAllArtists(fetchFn, artistNames, title, duration)
}

const UseSelectedProvider = (provider: string, song: StreamedSongMetadata): Promise<ProviderLyrics | false> => {
	let providerPromise: Promise<ProviderLyrics | undefined>
	switch (provider) {
		case "txw":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				return FetchTxwLyrics(song.Id, title, artist, undefined, song.Duration)
			})
			break
		case "spicylyrics":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				return FetchTxwLyrics(song.Id, title, artist, undefined, song.Duration)
			})
			break
		case "musixmatch":
			providerPromise = FetchMusixmatchLyrics(song.Id).then(res => {
				if (res !== undefined) return res
				return FetchProviderWithMeta((artist, title) => {
					let cleanTitle = title
					for (const filter of SongNameFilters) cleanTitle = cleanTitle.replace(filter, "")
					return FetchMusixmatchSearchLyrics(artist, cleanTitle.trim(), song.Duration)
				})
			})
			break
		case "musixmatch-search":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				let cleanTitle = title
				for (const filter of SongNameFilters) cleanTitle = cleanTitle.replace(filter, "")
				return FetchMusixmatchSearchLyrics(artist, cleanTitle.trim(), song.Duration)
			})
			break
		case "lrclib":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				let cleanTitle = title
				for (const filter of SongNameFilters) cleanTitle = cleanTitle.replace(filter, "")
				return FetchLRCLIBLyrics(artist, cleanTitle.trim(), song.Duration)
			})
			break
		case "spotify":
			providerPromise = FetchDirectSpotifyLyrics(song.Id, song.InternalId)
			break
		case "amlldb":
			providerPromise = FetchAMLLDBLyrics(song.Id).then(res => {
				if (res !== undefined) return res
				return FetchProviderWithMeta((artist, title) => {
					return FetchTxwLyrics(song.Id, title, artist, undefined, song.Duration)
				})
			})
			break
		case "deezer":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				return FetchDeezerLyrics(artist, title, song.Duration).then(res => {
					if (res !== undefined) return res
					return FetchTxwLyrics(song.Id, title, artist, undefined, song.Duration)
				})
			}, song.Duration)
			break
		case "youtube":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				return FetchYouTubeLyrics(artist, title).then(res => {
					if (res !== undefined) return res
					return FetchTxwLyrics(song.Id, title, artist, undefined, song.Duration)
				})
			})
			break
		case "genius":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				return FetchGeniusLyrics(artist, title).then(res => {
					if (res !== undefined) return res
					return FetchTxwLyrics(song.Id, title, artist, undefined, song.Duration)
				})
			})
			break
		case "netease":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				return FetchNeteaseLyrics(artist, title).then(res => {
					if (res !== undefined) return res
					return FetchTxwLyrics(song.Id, title, artist, undefined, song.Duration)
				})
			})
			break
		case "qq":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				return FetchQQMusicLyrics(artist, title).then(res => {
					if (res !== undefined) return res
					return FetchTxwLyrics(song.Id, title, artist, undefined, song.Duration)
				})
			})
			break
		case "kugou":
			providerPromise = FetchProviderWithMeta((artist, title) => {
				return FetchKugouLyrics(artist, title).then(res => {
					if (res !== undefined) return res
					return FetchTxwLyrics(song.Id, title, artist, undefined, song.Duration)
				})
			})
			break
		case "betterlyrics":
			providerPromise = FetchProviderWithMeta(FetchBetterLyricsTTML)
			break
		case "betterlyrics-kugou":
			providerPromise = FetchProviderWithMeta(FetchBetterLyricsKugou)
			break
		case "betterlyrics-legacy":
			providerPromise = FetchProviderWithMeta(FetchBetterLyricsLegacy)
			break
		case "betterlyrics-qq":
			providerPromise = FetchProviderWithMeta(FetchBetterLyricsQQ)
			break
		case "betterlyrics-unison":
			providerPromise = FetchProviderWithMeta(FetchBetterLyricsUnison)
			break
		case "betterlyrics-unison-line":
			providerPromise = FetchProviderWithMeta(FetchBetterLyricsUnisonLine)
			break
		case "bini":
			providerPromise = FetchProviderWithMeta(FetchBiniLyrics)
			break
		case "bini-line":
			providerPromise = FetchProviderWithMeta(FetchBiniLyricsLine)
			break
		case "lyricsovh":
			providerPromise = FetchProviderWithMeta(FetchLyricsOvh)
			break
		default:
			providerPromise = Promise.resolve(undefined)
	}
	return providerPromise.then(lyrics => lyrics ?? false)
}

// Timeout helper: resolves undefined if promise takes longer than ms
const withTimeout = <T>(promise: Promise<T | undefined>, ms: number): Promise<T | undefined> => {
	return Promise.race([
		promise,
		new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))
	])
}

// Race multiple providers in parallel, resolve with first non-undefined result or undefined
const raceProviders = (providers: (() => Promise<ProviderLyrics | undefined>)[], timeoutMs: number): Promise<ProviderLyrics | undefined> => {
	return new Promise(resolve => {
		if (providers.length === 0) return resolve(undefined)
		let pending = providers.length
		let resolved = false
		for (const provider of providers) {
			withTimeout(provider(), timeoutMs).then(result => {
				if (resolved) return
				if (result !== undefined) {
					resolved = true
					resolve(result)
				} else {
					pending--
					if (pending === 0) resolve(undefined)
				}
			})
		}
	})
}

const LoadSongLyrics = () => {
	// Remove our prior lyric state
	HaveSongLyricsLoaded = false, SongLyrics = undefined

	// Check if we can even possibly have lyrics
	const songAtUpdate = Song
	if ((songAtUpdate === undefined) || (songAtUpdate.Type !== "Streamed")) {
		HaveSongLyricsLoaded = true
		SongLyricsLoadedSignal.Fire()
		return
	}

	const selectedProvider = GetSelectedProvider()

	// Now go through the process of loading our lyrics
	{
		// First determine if we have our lyrics stored already
		ProviderLyricsStore.GetItem(songAtUpdate.Id)
		.then(
			providerLyrics => {
				if (providerLyrics === undefined) { // Otherwise, get our lyrics
					// If a specific provider is selected, use it directly
					if (selectedProvider !== "auto") {
						return UseSelectedProvider(selectedProvider, songAtUpdate)
					}

				// Otherwise, use the normal chain (author backend + fallbacks)
				return (
					(
						GetSpotifyAccessToken()
						.then(
							async (accessToken): Promise<Response | undefined> => {
								const controller = new AbortController()
								const timeout = globalThis.setTimeout(() => controller.abort(), 7000)
								const requestUrl = await BuildLyricsRequestURL(songAtUpdate)
								return fetch(
									requestUrl,
									{
										method: "GET",
										signal: controller.signal,
										headers: {
											Authorization: `Bearer ${accessToken}`,
											"X-Spotify-App-Platform": SpotifyPlatform?.PlatformData?.app_platform ?? "Linux",
											"X-Spotify-App-Version": SpotifyPlatform?.version ?? "1.0.0"
										}
									}
								).finally(() => globalThis.clearTimeout(timeout))
							}
						)
						.then(
							(response) => {
								if (response === undefined || response.ok === false) {
									throw `Failed to load Lyrics for Track (${
										songAtUpdate.Id
									}), Error: ${
										(response === undefined) ? "No response" : `${response.status} ${response.statusText}`
									}`
								}

								return response.text()
							}
						)
						.then(
							text => {
								if (text.length === 0) {
									return undefined
								} else {
									return JSON.parse(text)
								}
							}
						)
					)
					.catch(
						() => undefined as undefined
					)
						.then(
							(providerLyrics) => {
								if (providerLyrics !== undefined && providerLyrics !== null && typeof providerLyrics === "object" && typeof providerLyrics.Type === "string") return providerLyrics
								if (GetUseFallbackProviders() === false) return undefined
								const meta = SpotifyPlayer.data?.item?.metadata as unknown as (TrackMetadata | undefined)
								const track = SpotifyPlayer.data?.item
								const rawTitle = meta?.title ?? track?.name
								if (rawTitle === undefined || rawTitle.length === 0) return undefined
								const cleanTitle = FilterSongName(rawTitle)
								const rawArtist = meta?.artist_name ?? ""
								const firstArtist = (
									track?.artists?.map(a => a.name).filter(n => n !== undefined && n.length > 0)[0]
									?? rawArtist.split(/\s*[,;&]|(?:\s+feat[.])/i).map(a => a.trim()).filter(a => a.length > 0)[0]
									?? rawArtist
								)
								if (firstArtist.length === 0) return undefined
							// Fire top providers in parallel, take the first success
							return raceProviders([
								() => FetchMusixmatchLyrics(songAtUpdate.Id),
								() => FetchLRCLIBLyrics(firstArtist, cleanTitle.trim(), songAtUpdate.Duration),
								() => FetchBetterLyricsUnison(firstArtist, cleanTitle),
								() => FetchBiniLyrics(firstArtist, cleanTitle),
								() => FetchLyricsOvh(firstArtist, cleanTitle),
							], 4000)
							}
						)
						.then(
							(providerLyrics) => {
								if (providerLyrics !== undefined) return providerLyrics
								if (GetUseFallbackProviders() === false) return undefined
								return withTimeout(FetchProviderWithMeta(FetchMusixmatchSearchLyrics, songAtUpdate.Duration), 4000)
							}
						)
						.then(
							(providerLyrics) => {
								if (providerLyrics !== undefined) return providerLyrics
								if (GetUseFallbackProviders() === false) return undefined
								return withTimeout(FetchDirectSpotifyLyrics(songAtUpdate.Id, songAtUpdate.InternalId), 4000)
							}
						)
						.then(
							(providerLyrics) => {
								if (providerLyrics !== undefined) return providerLyrics
								if (GetUseFallbackProviders() === false) return undefined
								return withTimeout(FetchProviderWithMeta(FetchLRCLIBLyrics, songAtUpdate.Duration), 4000)
							}
						)
						.then(
							(providerLyrics) => {
								if (providerLyrics !== undefined) return providerLyrics
								if (GetUseFallbackProviders() === false) return undefined
								// Try LRCLIB by ISRC if available from cached track info
								return TrackInformationStore.GetItem(songAtUpdate.Id).then(trackInfo => {
									const isrc = trackInfo?.external_id?.find((e: any) => e.type === "isrc")?.id
									if (isrc !== undefined && isrc.length > 0) {
										return withTimeout(FetchLRCLIBByISRC(isrc), 4000)
									}
									return undefined
								})
							}
						)
					.then(
						(providerLyrics) => {
							if (providerLyrics !== undefined) return providerLyrics
							if (GetUseFallbackProviders() === false) return undefined
							return withTimeout(FetchProviderWithMeta(FetchBetterLyricsUnison), 5000)
						}
					)
						.then(
							(providerLyrics) => {
								if (providerLyrics !== undefined) return providerLyrics
								if (GetUseFallbackProviders() === false) return undefined
								return withTimeout(FetchProviderWithMeta(FetchBetterLyricsUnisonLine), 5000)
							}
						)
						.then(
							(providerLyrics) => {
								if (providerLyrics !== undefined) return providerLyrics
								if (GetUseFallbackProviders() === false) return undefined
								return withTimeout(FetchProviderWithMeta(FetchBiniLyricsLine), 4000)
							}
						)
						.then(
							(providerLyrics) => {
								const lyrics = (providerLyrics ?? false)
								ProviderLyricsStore.SetItem(songAtUpdate.Id, lyrics)
								return lyrics
							}
						)
					)
				} else {
					return providerLyrics
				}
			}
		)
		.then(
			(storedProviderLyrics): Promise<[(ProviderLyrics | false), (TransformedLyrics | false | undefined)]> => {
				return (
					TransformedLyricsStore.GetItem(songAtUpdate.Id)
					.then(storedTransformedLyrics => [storedProviderLyrics, storedTransformedLyrics])
				)
			}
		)
		.then(
			([storedProviderLyrics, storedTransformedLyrics]): Promise<TransformedLyrics | undefined> => {
				// If we do not have anything stored for our transformed-lyrics then we need to generate it
				if (storedTransformedLyrics === undefined) {
					return (
						(
							(storedProviderLyrics === false) ? Promise.resolve<false>(false)
							: (
								SetRomanizationSeparator(
									GetDynamicStoreItem<string>("BeautifulLyrics", "RomanizationSeparator") ?? ""
								),
								TransformProviderLyrics(storedProviderLyrics)
								.catch(() => storedProviderLyrics as TransformedLyrics)
							)
						)
						.then(
							transformedLyrics => {
								// Save our information
								TransformedLyricsStore.SetItem(songAtUpdate.Id, transformedLyrics)

								// Now return our information
								return (transformedLyrics || undefined)
							}
						)
					)
				} else {
					return Promise.resolve(storedTransformedLyrics || undefined)
				}
			}
		)
		.then(
			transformedLyrics => {
				// Make sure we still have the same song active
				if (Song !== songAtUpdate) {
					return
				}

				// Update our lyrics
				SongLyrics = transformedLyrics, HaveSongLyricsLoaded = true
				SongLyricsLoadedSignal.Fire()
			}
		)
	}
}

// Wait for Spotify to be ready
OnSpotifyReady.then(
	() => {
		/*
			We override the RequestBuilder so we can store
			Send promises for track information requests.

			This is so we don't pollute the console with faulty errors/warnings
			about duplicate requests being sent around the same time.
		*/
		if (SpotifyRequestBuilder !== undefined) {
			// Reset any pending requests
			SpotifyRequestBuilder.resetPendingRequests()

			// Create our override
			const originalBuildMethod = SpotifyRequestBuilder.build

			const trackPromises = new Map<string, Promise<unknown>>()
			SpotifyRequestBuilder.build = (...buildArguments: unknown[]) => {
				const builder = originalBuildMethod.call(SpotifyRequestBuilder, ...buildArguments)
				
				const originalOnAfterSendMethod = builder.onAfterSend
				let removeTrackPromiseId: (string | undefined)
				builder.onAfterSend = (...onAfterSendArguments: unknown[]) => {
					if (removeTrackPromiseId !== undefined) {
						trackPromises.delete(removeTrackPromiseId)
					}
					return originalOnAfterSendMethod.call(builder, ...onAfterSendArguments)
				}

				const originalSendMethod = builder.send
				builder.send = (...sendArguments: unknown[]) => {
					const isTrackInformationRequest = (
						(builder.host === "https://spclient.wg.spotify.com/metadata/4")
						&& builder.path.startsWith("/track/")
						&& builder.endpointIdentifier?.startsWith("/track/")
					)

					if (isTrackInformationRequest) {
						const existingPromise = trackPromises.get(`${builder.host}${builder.path}`)
						if (existingPromise !== undefined) {
							return existingPromise
						}
					}

					const sendPromise = originalSendMethod.call(builder, ...sendArguments)
					if (isTrackInformationRequest) {
						const trackPromiseId = `${builder.host}${builder.path}`
						trackPromises.set(trackPromiseId, sendPromise)
						removeTrackPromiseId = trackPromiseId
					}

					return sendPromise
				}

				return builder
			}

			PlayerMaid.Give(
				() => SpotifyRequestBuilder.build = originalBuildMethod,
				"RequestBuilderOverride"
			)
		}

		// Handle song updates
		{
			const OnSongChange = () => {
				// Wait until we have our SpotifyPlayer data
				if (SpotifyPlayer.data === undefined || SpotifyPlayer.data === null) {
					if (Song !== undefined) {
						Song = undefined
						SongChangedSignal.Fire()
					}

					if (SongContext !== undefined) {
						SongContext = undefined
						SongContextChangedSignal.Fire()
					}

					return
				}

				// Make sure that this is a Song and not any other type of track
				const track = SpotifyPlayer.data.item
				if (track === undefined || track === null) {
					if (Song !== undefined) {
						Song = undefined
						SongChangedSignal.Fire()
					}
					return
				}
				const isASong = (track.type === "track")
				const isDJ = ((track.type === "unknown") && (track.provider?.startsWith("narration") ?? false))
				if ((isASong === false) && (isDJ === false)) {
					Song = undefined
				} else {
					// Set our Timestamp to 0 immediately
					Timestamp = 0

					// Create our song-information
					const metadata = track.metadata as unknown as TrackMetadata
					const uri = SpotifyURI.from(track.uri)
					Song = Object.freeze(
						isDJ ? {
							Type: "DJ",

							Uri: track.uri,
							Action: track.name,
							CoverArt: {
								Large: metadata?.image_xlarge_url,
								Big: metadata?.image_large_url,
								Default: metadata?.image_url,
								Small: metadata?.image_small_url
							}
						}
						: (metadata?.is_local === "true") ? {
							Type: "Local",

							Uri: track.uri,
							Duration: (SpotifyPlayer.data.duration / 1000),
							CoverArt: SpotifyPlayer.data.item.images?.[0]?.url
						}
						: {
							Type: "Streamed",

							Uri: track.uri,
							Id: uri!.id!,
							InternalId: SpotifyURI.idToHex(uri!.id!),
							Duration: (SpotifyPlayer.data.duration / 1000),
							CoverArt: {
								Large: metadata?.image_xlarge_url,
								Big: metadata?.image_large_url,
								Default: metadata?.image_url,
								Small: metadata?.image_small_url
							}
						}
					)
				}

				// Load our song details AND lyrics
				HasIsLikedLoaded = false
				LoadSongDetails()
				LoadSongLyrics()

				// Fire our events
				SongChangedSignal.Fire()

				// Determine if our context changed
				if ((SpotifyPlayer.data.hasContext === false || !SpotifyPlayer.data.context) && (SongContext !== undefined)) {
					SongContext = undefined
					SongContextChangedSignal.Fire()
				} else if (
					SpotifyPlayer.data.context
					&& (
						(SongContext === undefined)
						|| (SongContext.Uri !== SpotifyPlayer.data.context.uri)
					)
				) {
					const contextMetadata = SpotifyPlayer.data.context.metadata as unknown as {
						context_description: string;
						image_url: string;
					}
					const baseSongContext = {
						Uri: SpotifyPlayer.data.context.uri,
						CoverArt: ((contextMetadata?.image_url === "") ? undefined : contextMetadata?.image_url),
						Description: contextMetadata?.context_description
					}

					if (baseSongContext.Uri === "spotify:internal:local-files") {
						SongContext = {
							Type: "LocalFiles",
							...baseSongContext
						}
					} else {
						const uri = SpotifyURI.from(SpotifyPlayer.data.context.uri)
						if (uri?.type?.startsWith("playlist")) {
							SongContext = {
								Type: "Playlist",
								Id: uri.id!,
								...baseSongContext
							}
						} else if (uri?.type === "album") {
							SongContext = {
								Type: "Album",
								Id: uri.id!,
								...baseSongContext
							}
						} else {
							SongContext = {
								Type: "Other",
								...baseSongContext
							}
						}
					}

					SongContextChangedSignal.Fire()
				}
			}
			OnSongChange()
			SpotifyPlayer.addEventListener("songchange", OnSongChange)
			PlayerMaid.Give(() => SpotifyPlayer.removeEventListener("songchange", OnSongChange))
		}
		
		// Hande loop/shuffle updates
		{
			const OnUpdate = () => {
				const newIsLiked = ((Song === undefined) ? false : SpotifyPlayer.getHeart())
				if ((HasIsLikedLoaded === false) || (IsLiked !== newIsLiked)) {
					IsLiked = newIsLiked
					HasIsLikedLoaded = true
					IsLikedChangedSignal.Fire()
				}

				const newShuffleState = SpotifyPlayer.getShuffle()
				if (IsShuffling !== newShuffleState) {
					IsShuffling = newShuffleState
					IsShufflingChangedSignal.Fire()
				}

				const loopSetting = SpotifyPlayer.getRepeat()
				const newLoopMode = ((loopSetting === 0) ? "Off" : (loopSetting === 1) ? "Context" : "Song")
				if (LoopMode !== newLoopMode) {
					LoopMode = newLoopMode
					LoopModeChangedSignal.Fire()
				}
			}
			OnUpdate()
			// deno-lint-ignore no-explicit-any
			const eventsTarget = (SpotifyPlatform?.PlayerAPI as any)?._events ?? (SpotifyPlayer as any)?.origin?._events
			if (eventsTarget?.addListener) {
				eventsTarget.addListener("update", OnUpdate)
				PlayerMaid.Give(() => eventsTarget.removeListener?.("update", OnUpdate))
			}
			SpotifyPlayer.addEventListener("songchange", OnUpdate)
			PlayerMaid.Give(() => SpotifyPlayer.removeEventListener("songchange", OnUpdate))
		}

		// Handle playing updates
		const CheckIsPlaying = (): boolean => {
			if (typeof SpotifyPlayer?.isPlaying === "function") {
				try {
					return Boolean(SpotifyPlayer.isPlaying())
				} catch (_) {}
			}

			// deno-lint-ignore no-explicit-any
			const data = SpotifyPlayer?.data as any
			if (data !== undefined && data !== null) {
				if (typeof data.isPaused === "boolean") {
					return !data.isPaused
				}
				if (typeof data.is_paused === "boolean") {
					return !data.is_paused
				}
			}

			// deno-lint-ignore no-explicit-any
			const state = SpotifyPlatform?.PlayerAPI?._state as any
			if (state && typeof state.isPaused === "boolean") {
				return !state.isPaused
			}

			return false
		}

		const UpdatePlayingState = () => {
			const newIsPlaying = CheckIsPlaying()
			if (IsPlaying !== newIsPlaying) {
				IsPlaying = newIsPlaying
				IsPlayingChangedSignal.Fire()

				if (IsPlaying === false) {
					PlayerMaid.Clean("AutomaticSync")
				}
			}
		}

		UpdatePlayingState()
		SpotifyPlayer.addEventListener("onplaypause", UpdatePlayingState)
		SpotifyPlayer.addEventListener("songchange", UpdatePlayingState)
		SpotifyPlayer.addEventListener("onprogress", UpdatePlayingState)
		PlayerMaid.Give(() => {
			SpotifyPlayer.removeEventListener("onplaypause", UpdatePlayingState)
			SpotifyPlayer.removeEventListener("songchange", UpdatePlayingState)
			SpotifyPlayer.removeEventListener("onprogress", UpdatePlayingState)
		})

		// deno-lint-ignore no-explicit-any
		const playerEventsTarget = (SpotifyPlatform?.PlayerAPI as any)?._events ?? (SpotifyPlayer as any)?.origin?._events
		if (playerEventsTarget?.addListener) {
			playerEventsTarget.addListener("update", UpdatePlayingState)
			PlayerMaid.Give(() => playerEventsTarget.removeListener?.("update", UpdatePlayingState))
		}

		// Handle provider changes - re-fetch lyrics
		{
			const ClearSongCache = (songId: string) => {
				caches.open("Player_ProviderLyrics").then(c => c.delete(`/${songId}`))
				caches.open("Player_TransformedLyrics").then(c => c.delete(`/${songId}`))
			}
			const OnProviderChanged = () => {
				if (Song?.Type === "Streamed") {
					ClearSongCache(Song.Id)
				}
				LoadSongLyrics()
			}
			globalThis.addEventListener("beautiful-lyrics:provider-changed", OnProviderChanged)
			PlayerMaid.Give(() => globalThis.removeEventListener("beautiful-lyrics:provider-changed", OnProviderChanged))
		}

		// Helper to query position in seconds synchronously
		const GetPlayerPositionSeconds = (): number => {
			if (typeof SpotifyPlayer?.getProgress === "function") {
				try {
					const p = SpotifyPlayer.getProgress()
					if (typeof p === "number" && !isNaN(p) && p >= 0) {
						return p / 1000
					}
				} catch (_) {}
			}

			// deno-lint-ignore no-explicit-any
			const state = SpotifyPlatform?.PlayerAPI?._state as any
			if (state && typeof state.positionAsOfTimestamp === "number") {
				const isPaused = Boolean(state.isPaused)
				const base = state.positionAsOfTimestamp
				const elapsed = (isPaused || typeof state.timestamp !== "number")
					? 0
					: Math.max(0, Date.now() - state.timestamp)
				return (base + elapsed) / 1000
			}

			// deno-lint-ignore no-explicit-any
			const data = SpotifyPlayer?.data as any
			if (data) {
				if (typeof data.positionAsOfTimestamp === "number") {
					const isPaused = typeof data.isPaused === "boolean" ? data.isPaused : Boolean(data.is_paused)
					const elapsed = (isPaused || typeof data.timestamp !== "number")
						? 0
						: Math.max(0, Date.now() - data.timestamp)
					return (data.positionAsOfTimestamp + elapsed) / 1000
				}
				if (typeof data.progress === "number") {
					return data.progress / 1000
				}
			}

			return 0
		}

		// Handle timestamp updates
		{
			let lastUpdatedAt = performance.now()
			let lastFpsTimestamp = performance.now()
			let isFirstFrame = true

			SongChangedSignal.Connect(() => {
				isFirstFrame = true
			})

			// deno-lint-ignore no-explicit-any
			const OnProgress = (event?: any) => {
				const progressMs = typeof event?.data === "number" ? event.data : undefined
				if (progressMs !== undefined && !isNaN(progressMs) && progressMs >= 0) {
					const progressSec = progressMs / 1000
					if (Math.abs(progressSec - Timestamp) > 0.35) {
						Timestamp = progressSec
						TimeSteppedSignal.Fire(0, true)
					}
				}
			}
			SpotifyPlayer.addEventListener("onprogress", OnProgress)
			PlayerMaid.Give(() => SpotifyPlayer.removeEventListener("onprogress", OnProgress))

			const Update = () => {
				// Update playing state every frame to catch any missed events
				UpdatePlayingState()

				const updatedAt = performance.now()
				const deltaTime = Math.max(0, (updatedAt - lastUpdatedAt) / 1000)
				lastUpdatedAt = updatedAt

				if (Song !== undefined) {
					const playerPos = GetPlayerPositionSeconds()
					let fireDeltaTime = deltaTime
					let skipped = false

					if (isFirstFrame || Timestamp < 0) {
						Timestamp = playerPos
						isFirstFrame = false
						skipped = true
						fireDeltaTime = 0
					} else if (IsPlaying) {
						const drift = playerPos - Timestamp
						if (Math.abs(drift) > 0.35) {
							// User seeked or track jumped
							Timestamp = playerPos
							skipped = true
							fireDeltaTime = 0
						} else {
							// Continuous playback: increment by delta time
							Timestamp += deltaTime
							// Smooth subtle drift alignment
							if (Math.abs(drift) > 0.04) {
								Timestamp += drift * 0.1
							}
							fireDeltaTime = deltaTime
						}
					} else {
						// Paused: follow scrubber if moved
						if (Math.abs(playerPos - Timestamp) > 0.05) {
							Timestamp = playerPos
							skipped = true
						}
						fireDeltaTime = 0
					}

					// FPS limit: skip rendering if over target
					const fpsRaw = GetDynamicStoreItem<string>("BeautifulLyrics", "FPS")
					const targetFps = fpsRaw ? Number(fpsRaw) : 60
					let shouldRender = true
					if (targetFps < 60) {
						const interval = 1000 / targetFps
						if ((updatedAt - lastFpsTimestamp) < interval) {
							shouldRender = false
						} else {
							lastFpsTimestamp = updatedAt
						}
					}

					if (shouldRender) {
						if (IsPlaying || skipped) {
							TimeSteppedSignal.Fire(fireDeltaTime, skipped ? true : undefined)
						}
					}
				} else {
					isFirstFrame = true
				}

				PlayerMaid.Give(Defer(Update), "Timestep")
			}

			// Immediately start the update loop
			Update()
		}
	}
)


