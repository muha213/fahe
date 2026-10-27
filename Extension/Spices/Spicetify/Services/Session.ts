// Imported Types
import type SpicetifyTypes from "../Types/App/Spicetify.ts"

// Web-Modules
import { Maid } from '@Universal/Modules/Maid.ts'
import { Defer, Timeout } from '@Universal/Modules/Scheduler.ts'

// Spotify Types
export type HistoryLocation = {
	pathname: string;
	search: string;
	hash: string;
	// deno-lint-ignore no-explicit-any
	state: Record<string, any>;
}

// Create our Global-Maid (keeps track of all our sub-processes)
export const GlobalMaid: Maid = new Maid()

// Development Environment Flag (useful for testing purposes)
export const IsDevelopment: boolean = import.meta.url.includes("localhost")

// Store all our Spotify Services
// deno-lint-ignore no-explicit-any
export const Spotify: typeof SpicetifyTypes = (globalThis as any).Spicetify
export let SpotifyPlayer: typeof SpicetifyTypes.Player
export let SpotifyPlatform: typeof SpicetifyTypes.Platform
export let SpotifyHistory: {
	push: ((path: HistoryLocation | string) => void);
	replace: ((path: HistoryLocation | string) => void);
	goBack: (() => void);
	goForward: (() => void);
	listen: ((listener: (location: HistoryLocation) => void) => () => void);
	location: HistoryLocation;
	entries: HistoryLocation[];
}
export let SpotifyPlaybar: typeof Spotify.Playbar
// deno-lint-ignore no-explicit-any
export let SpotifySnackbar: any
export let SpotifyInternalFetch: typeof SpicetifyTypes.CosmosAsync
export let SpotifyURI: typeof SpicetifyTypes.URI
export let SpotifyRequestBuilder: typeof SpicetifyTypes.Platform.RequestBuilder

// Handle Spotify loaded process
let MakeSpotifyReady: () => void
const SpotifyReadyPromise: Promise<void> = new Promise(resolve => MakeSpotifyReady = resolve)
export const OnSpotifyReady = SpotifyReadyPromise
{
	// Re-usable key so our retry passes replace each other instead of piling up
	const ServiceCheckKey = "SpotifyServiceCheck"

	// Track how long we've been waiting so we can explain a stall instead of
	// silently doing nothing forever
	let serviceChecks = 0
	let hasWarnedAboutStall = false
	const WaitForServices = () => {
		serviceChecks++
		if ((serviceChecks === 60) && (hasWarnedAboutStall === false)) {
			hasWarnedAboutStall = true
			console.warn(
				"Beautiful Lyrics: still waiting on Spotify after 60 attempts.",
				"If this persists, share your Spotify/Spicetify information (shift+b+l>i) in the Spicetify Discord."
			)
		}

		GlobalMaid.Give(Defer(CheckForServices), ServiceCheckKey)
	}

	const CheckForServices = () => {
		serviceChecks = 0

		// Spicetify itself may not have populated the global yet
		if ((Spotify === undefined) || (Spotify === null)) {
			WaitForServices()
			return
		}

		// Update our service references
		SpotifyPlayer = Spotify.Player
		SpotifyPlatform = Spotify.Platform
		SpotifyHistory = SpotifyPlatform?.History ?? (Spotify as any)?.History ?? (SpotifyPlatform as any)?.HistoryAPI
		SpotifyPlaybar = Spotify.Playbar
		// deno-lint-ignore no-explicit-any
		SpotifySnackbar = (Spotify as any).Snackbar
		SpotifyInternalFetch = Spotify.CosmosAsync
		SpotifyURI = Spotify.URI

		// Determine if we have our essential services
		if (
			(SpotifyPlayer === undefined)
			|| (SpotifyPlatform === undefined)
			|| (SpotifyHistory === undefined)
			|| (SpotifyPlaybar === undefined)
			|| (SpotifyInternalFetch === undefined)
			|| (SpotifyURI === undefined)
		) {
			WaitForServices()
			return
		}

		// Ensure SpotifyHistory has entries array so indexing doesn't throw in React Router v6
		if (SpotifyHistory && !Array.isArray(SpotifyHistory.entries)) {
			SpotifyHistory.entries = []
			if (SpotifyHistory.location) {
				SpotifyHistory.entries.push(SpotifyHistory.location)
			}
			if (typeof SpotifyHistory.listen === "function") {
				SpotifyHistory.listen((loc: HistoryLocation) => {
					if (SpotifyHistory?.entries) {
						SpotifyHistory.entries.push(loc)
					}
				})
			}
		}

		if (SpotifyRequestBuilder === undefined) {
			// If everything else loaded, our Platform.RequestBuilder should be as well
			SpotifyRequestBuilder = SpotifyPlatform.RequestBuilder

			// Couldn't find it directly so we'll have to search for it (older versions of Spotify primarily)
			if (SpotifyRequestBuilder === undefined) {
				const stack: Record<string, unknown>[] = [Spotify]
				const seenInStack = new Set()
				while (stack.length > 0) {
					const searchIn = stack.pop()!
					for (
						const key
						of [
							...Object.getOwnPropertyNames(searchIn),
							...Object.getOwnPropertyNames(Object.getPrototypeOf(searchIn) || [])
						]
					) {
						// It's possible that indexing into the object will throw an error
						try {
							const value = searchIn[key]
							if (seenInStack.has(value)) {
								continue
							} else if ((value === null) || (value === undefined)) {
								continue
							} else if (typeof value === "object") {
								const prototype = Object.getPrototypeOf(value)
								if (
									(typeof(prototype.resetPendingRequests) === "function")
									&& (typeof(prototype.build) === "function")
									&& (typeof((value as Record<string, unknown>).pendingRequests) === "object")
								) {
									SpotifyRequestBuilder = value
									break
								}
			
								stack.push(value as Record<string, unknown>)
							}
				
							seenInStack.add(value)
						} catch (_) { /* Do nothing */ }
					}

					if (SpotifyRequestBuilder !== undefined) {
						break
					}
				}
			}

			// In new Spotify versions, RequestBuilder was removed; we fall back to CosmosAsync/Fetch
			if (SpotifyRequestBuilder === undefined) {
				console.info("Beautiful Lyrics: SpotifyRequestBuilder not present (using CosmosAsync/Fetch fallback)")
			}
		}

		GlobalMaid.Give(Defer(MakeSpotifyReady), "MakeSpotifyReady")
	}
	CheckForServices()
}

// Handle token-fetching
type TokenProviderResponse = {
	accessToken: string,
	expiresAtTime: number,
	tokenType: "Bearer"
}
let tokenProviderResponse: (TokenProviderResponse | undefined)
let accessTokenPromise: Promise<string> | undefined
export const GetSpotifyAccessToken = async (): Promise<string> => {
	// Determine if we have a valid non-expiring cached token
	if (tokenProviderResponse !== undefined) {
		const timeUntilRefresh = ((tokenProviderResponse.expiresAtTime - Date.now()) / 1000)
		if (timeUntilRefresh > 5) {
			return tokenProviderResponse.accessToken
		}
		tokenProviderResponse = undefined
	}

	// If we already have an access-token promise, return it
	if (accessTokenPromise !== undefined) {
		return accessTokenPromise
	}

	accessTokenPromise = (async () => {
		// 1. Try SpotifyPlatform.Session
		// deno-lint-ignore no-explicit-any
		const session = (SpotifyPlatform as any)?.Session ?? (Spotify as any)?.Platform?.Session
		if (session?.accessToken) {
			tokenProviderResponse = {
				accessToken: session.accessToken,
				expiresAtTime: session.accessTokenExpirationTimestampMs ?? (Date.now() + 3600 * 1000),
				tokenType: "Bearer"
			}
			return tokenProviderResponse.accessToken
		}

		// 2. Try SpotifyPlatform.AuthorizationAPI
		// deno-lint-ignore no-explicit-any
		const authApi = (SpotifyPlatform as any)?.AuthorizationAPI ?? (Spotify as any)?.Platform?.AuthorizationAPI
		if (typeof authApi?.getToken === "function") {
			try {
				const res = await authApi.getToken()
				if (res?.accessToken) {
					tokenProviderResponse = {
						accessToken: res.accessToken,
						expiresAtTime: res.accessTokenExpirationTimestampMs ?? (Date.now() + 3600 * 1000),
						tokenType: "Bearer"
					}
					return tokenProviderResponse.accessToken
				}
			} catch (_) { /* Do nothing */ }
		}

		// 3. Try CosmosAsync sp://oauth/v2/token
		if (SpotifyInternalFetch !== undefined) {
			try {
				const result = await (SpotifyInternalFetch.get("sp://oauth/v2/token") as Promise<TokenProviderResponse>)
				if (result?.accessToken) {
					tokenProviderResponse = result
					return result.accessToken
				}
			} catch (_) { /* Do nothing */ }
		}

		return ""
	})().finally(() => {
		accessTokenPromise = undefined
	})

	return accessTokenPromise
}

// Allows for Spotify API requests to be made without CosmosASYNC (which doesn't support all endpoints anymore)
export const SpotifyFetch = (url: string): Promise<Response> => {
	return (
		GetSpotifyAccessToken()
		.then(
			accessToken => fetch(
				url,
				{
					headers: {
						...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {}),
						"Spotify-App-Version": SpotifyPlatform?.version ?? "",
						"App-Platform": SpotifyPlatform?.PlatformData?.app_platform ?? ""
					}
				}
			)
		)
	)
}

// Easy way to show a custom HTML notification
export const ShowNotification = (
	html: string, variant: ("info" | "success" | "warning" | "error" | "default"),
	hideAfter: number
): void => {
	if (SpotifySnackbar?.enqueueSnackbar && Spotify?.React) {
		SpotifySnackbar.enqueueSnackbar(
			Spotify.React.createElement(
				"div",
				{
					dangerouslySetInnerHTML: {
						__html: html.trim()
					}
				}
			), {
				variant: variant,
				autoHideDuration: (hideAfter * 1000)
			}
		)
	} else if (typeof (Spotify as any)?.showNotification === "function") {
		(Spotify as any).showNotification(html.replace(/<[^>]*>/g, ""), variant === "error", hideAfter * 1000)
	} else {
		console.log(`[Beautiful Lyrics] [${variant}]: ${html.replace(/<[^>]*>/g, "")}`)
	}
}