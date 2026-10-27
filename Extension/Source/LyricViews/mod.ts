// Styles
import "./style.scss"
import "../Stylings/Views.scss"

// Imported Types
import Spicetify from "@Spices/Spicetify/Types/App/Spicetify.ts"

// NPM Packages
import { checkKey } from "npm:@rwh/keystrokes"

// Web Modules
import { Maid } from "@Universal/Modules/Maid.ts"
import { Defer, Timeout } from "@Universal/Modules/Scheduler.ts"

// Spices
import {
	GlobalMaid,
	OnSpotifyReady,
	HistoryLocation, SpotifyHistory, SpotifyPlaybar
} from "@Spices/Spicetify/Services/Session.ts"
import {
	Song, SongChanged,
	SongLyrics, SongLyricsLoaded, HaveSongLyricsLoaded
} from "@Spices/Spicetify/Services/Player/mod.ts"

// Components
import CardView from "./Card/mod.ts"
import ContainedPageView from "./Page/Contained.ts"
import FullscreenPageView from "./Page/Fullscreen.ts"

// Our Modules
import { CreateElement, ApplyDynamicBackground } from "./Shared.ts"
import Icons from "./Icons.ts"

// Create our maid
const ViewMaid = GlobalMaid.Give(new Maid())

// Template Constants
const LoadingLyricsCard = `<div class="LoadingLyricsCard Loading"></div>`

// DOM Search Constants
const CurrentMainPage = ".Root__main-view .main-view-container div[data-overlayscrollbars-viewport]"
const LegacyMainPage = ".Root__main-view .main-view-container .os-host"
const FallbackMainPage = ".Root__main-view .main-view-container"
const RightSidebar = ".Root__right-sidebar, aside[aria-label='Now playing view' i], aside.NowPlayingView, aside[data-testid='now-playing-view']"
const ContentsContainer = "aside, section.main-buddyFeed-container, div[data-testid='now-playing-widget'], .main-nowPlayingView-content"
const CardInsertAnchor = ".main-nowPlayingView-nowPlayingWidget, canvas, [data-testid='now-playing-widget']"
const SpotifyCardViewQuery = ".main-nowPlayingView-section:not(:is(#BeautifulLyrics-CardView)):has(.main-nowPlayingView-lyricsTitle), section:not(:is(#BeautifulLyrics-CardView)):has([aria-label*='lyrics' i])"

// Store our internal utilities
let SetPlaybarPageIconActiveState: (isActive: boolean) => void = () => {}
let ActivePageView: (ContainedPageView | FullscreenPageView | undefined)

// Surface a stage failure instead of letting it silently reject the chain
const ReportStageFailure = (stage: string, error: unknown) => {
	console.error(`Beautiful Lyrics: ${stage} failed to start.`, error)
}

// Find the element our contained page-view should be parented to. Spotify has
// reshuffled this markup across releases, so we try each known container before
// giving up rather than leaving the user with a button that does nothing.
const SearchForPageContainer = (): [HTMLDivElement, boolean] | undefined => {
	for (const [query, isLegacy] of [
		[CurrentMainPage, false],
		[LegacyMainPage, true],
		[FallbackMainPage, false],
		[".Root__main-view main", false],
		[".Root__main-view", false],
		["main[data-testid='main-view']", false],
		["main", false]
	] as [string, boolean][]) {
		const found = document.querySelector<HTMLDivElement>(query)
		if (found !== null) {
			return [found, isLegacy]
		}
	}

	return undefined
}

// Wait for Spotify to start our processing
OnSpotifyReady
.then( // Playbar Icons
	() => {
		// Store references for our buttons
		let lyricsButton: Spicetify.Playbar.Button
		let fullscreenButton: Spicetify.Playbar.Button

		// Lyrics Button
		{
			lyricsButton = new SpotifyPlaybar.Button(
				"Lyrics Page",
				Icons.LyricsPage,
				() => {
					if (ActivePageView === undefined) {
						SpotifyHistory.push(`/BeautifulLyrics/${checkKey("shift") ? "Fullscreen" : "Page"}`)
					} else {
						ActivePageView.Close()
						ActivePageView = undefined
					}
				},
				false, false
			)
			ViewMaid.Give(() => lyricsButton.deregister())

			{
				const CheckForSongExistence = () => {
					if (Song === undefined) {
						lyricsButton.deregister()
					} else {
						lyricsButton.register()
					}
				}
				ViewMaid.Give(SongChanged.Connect(CheckForSongExistence))
				ViewMaid.Give(Timeout(1, CheckForSongExistence))
			}

			SetPlaybarPageIconActiveState = (isActive: boolean) => lyricsButton.active = isActive
		}

		// Fullscreen Button
		{
			fullscreenButton = new SpotifyPlaybar.Button(
				"Enter Fullscreen",
				Icons.FullscreenOpen,
				() => SpotifyHistory.push(
					{
						pathname: "/BeautifulLyrics/Fullscreen",
						search: "",
						hash: "",
						state: {
							FromPlaybar: true
						}
					}
				),
				false,
				false
			)
			ViewMaid.Give(() => fullscreenButton.deregister())
	
			// Mark our fullscreen-button and force it to the right
			fullscreenButton.element.style.order = "100000"
			fullscreenButton.element.id = "BeautifulLyricsFullscreenButton"
		}

		// Handle removing our buttons if we DON'T have a song
		{
			const CheckForSongExistence = () => {
				if (Song === undefined) {
					lyricsButton.deregister()
					fullscreenButton.deregister()
				} else {
					lyricsButton.register()
					fullscreenButton.register()
				}
			}
			ViewMaid.Give(SongChanged.Connect(CheckForSongExistence))
			ViewMaid.Give(Timeout(1, CheckForSongExistence))
		}
	}
)
.catch( // Playbar Icons must never block the stages below them
	error => ReportStageFailure("Playbar Icons", error)
)
.then( // Right Side-bar/Card View
	() => {
		// Store our state
		let sidebar: HTMLDivElement, contentsContainer: (HTMLDivElement | undefined)
		const contentsContainerMaid = ViewMaid.Give(new Maid())
		const nowPlayingViewMaid = ViewMaid.Give(new Maid())

		// Each check method
		const CheckForNowPlaying = () => {
			// Clean-up when we are called
			nowPlayingViewMaid.CleanUp()

			// Now check to see if we have our card anchor
			const cardAnchor = contentsContainer!.querySelector<HTMLDivElement>(CardInsertAnchor)
			if (cardAnchor === null) {
				return
			}

			// Immediately add our class to the top container
			const backgroundMaid = nowPlayingViewMaid.Give(new Maid())
			let backgroundApplied = false
			const CheckDynamicBackground = () => {
				if (SpotifyHistory.location.pathname === "/BeautifulLyrics/Fullscreen") {
					backgroundMaid.CleanUp()
					backgroundApplied = false
				} else if (backgroundApplied === false) {
					backgroundApplied = true
					ApplyDynamicBackground(contentsContainer!, backgroundMaid)
				}
			}
			CheckDynamicBackground()
			nowPlayingViewMaid.Give(SpotifyHistory.listen(CheckDynamicBackground))

			// Now we can monitor for Spotifys lyrics card (and hide it)
			const cardContainer = cardAnchor.parentElement!
			const CheckForLyricsCard = () => {
				const cardView = cardContainer.querySelector<HTMLDivElement>(SpotifyCardViewQuery)
				if (cardView !== null) {
					cardView.style.display = "none"
				}
			}
			CheckForLyricsCard()
			const containerObserver = nowPlayingViewMaid.Give(new MutationObserver(CheckForLyricsCard))
			containerObserver.observe(cardContainer, { childList: true })

			// Also handle our own card
			const ShouldCreateCard = () => {
				if (
					// We shouldn't be rendering the card-view when we have another of our views open
					SpotifyHistory.location.pathname.startsWith("/BeautifulLyrics")
					|| (Song === undefined)
					|| (HaveSongLyricsLoaded && (SongLyrics === undefined))
				) {
					nowPlayingViewMaid.Clean("Card")
					return
				} else if (HaveSongLyricsLoaded === false) { // Render a template if we're still loading our lyrics
					const card = nowPlayingViewMaid.Give(CreateElement<HTMLDivElement>(LoadingLyricsCard), "Card")
					cardAnchor.after(card)

					return
				}

				nowPlayingViewMaid.Give(new CardView(cardAnchor), "Card")
			}
			ShouldCreateCard()
			nowPlayingViewMaid.GiveItems(
				SongLyricsLoaded.Connect(ShouldCreateCard),
				SpotifyHistory.listen(ShouldCreateCard)
			)
		}
		const DeferCheckForNowPlaying = () => ViewMaid.Give(Defer(CheckForNowPlaying), "CheckForNowPlaying")

		const CheckForContentsContainer = () => {
			// Clean-up when we are called
			contentsContainerMaid.CleanUp()
			nowPlayingViewMaid.CleanUp()

			// Determine if our contents-container even exists
			contentsContainer = (sidebar.querySelector<HTMLDivElement>(ContentsContainer) ?? undefined)
			if (contentsContainer === undefined) {
				return
			}

			// Check if there's anything we can do immediately
			CheckForNowPlaying()

			// Handle when we should check
			contentsContainerMaid.Give(SongChanged.Connect(DeferCheckForNowPlaying))

		}
		const DeferCheckForContentsContainer = () => ViewMaid.Give(Defer(CheckForContentsContainer), "CheckForContentsContainer")

		const CheckForSidebar = () => {
			// Check for our sidebar existing
			const newSidebar = document.querySelector<HTMLDivElement>(RightSidebar)
			if (newSidebar === null) {
				ViewMaid.Give(Defer(CheckForSidebar), "CheckForSidebar")
				return
			}
			sidebar = newSidebar

			// Create our observer
			const sidebarChildObserver = ViewMaid.Give(new MutationObserver(DeferCheckForContentsContainer))

			// Check if there's anything we can do immediately
			CheckForContentsContainer()

			// Observe our elements
			sidebarChildObserver.observe(sidebar, { childList: true })
			for (const element of sidebar.children) {
				if (
					(element instanceof HTMLDivElement)
					&& ((element.children.length === 0) || (element.querySelector(ContentsContainer) !== null))
				) {
					sidebarChildObserver.observe(element, { childList: true })
				}
			}
		}
		CheckForSidebar()
	}
)
.catch( // The card-view pulls in WebGL, which can fail outright on some machines
	error => ReportStageFailure("Right Side-bar/Card View", error)
)
.then( // Location Handler
	() => {
		let pageContainer: (HTMLDivElement | undefined)
		let pageContainerIsLegacy = false

		const TryResolvePageContainer = (): boolean => {
			if (pageContainer !== undefined) {
				return true
			}

			const resolved = SearchForPageContainer()
			if (resolved === undefined) {
				return false
			}

			;[pageContainer, pageContainerIsLegacy] = resolved
			return true
		}

		const RenderContainedPageView = () => {
			ViewMaid.Clean("PageViewRetry")
			SetPlaybarPageIconActiveState(true)
			ActivePageView = ViewMaid.Give(new ContainedPageView(pageContainer!, pageContainerIsLegacy), "PageView")
			ActivePageView.Closed.Connect(() => SetPlaybarPageIconActiveState(false))
			ActivePageView.Closed.Connect(() => ActivePageView = undefined)
		}

		// We can land on our page before the container exists, so keep looking
		// and render as soon as there is something to parent our view to
		const KeepLookingForPageContainer = () => {
			if (SpotifyHistory.location.pathname !== "/BeautifulLyrics/Page") {
				return
			}

			if (TryResolvePageContainer() === false) {
				ViewMaid.Give(Defer(KeepLookingForPageContainer), "PageViewRetry")
				return
			}

			RenderContainedPageView()
		}

		const HandleSpotifyLocation = (location: HistoryLocation) => {
			// Remove our previous page-view
			ViewMaid.Clean("PageView")
			ViewMaid.Clean("PageViewRetry")

			try {
				// Now handle our page-view
				if (location.pathname === "/BeautifulLyrics/Page") {
					if (TryResolvePageContainer()) {
						RenderContainedPageView()
					} else {
						KeepLookingForPageContainer()
					}
				} else if (location.pathname === "/BeautifulLyrics/Fullscreen") {
					ActivePageView = ViewMaid.Give(new FullscreenPageView(location.state?.FromPlaybar), "PageView")
					ActivePageView.Closed.Connect(() => ActivePageView = undefined)
				}
			} catch (error) {
				ViewMaid.Clean("PageView")
				ViewMaid.Clean("PageViewRetry")
				SetPlaybarPageIconActiveState(false)
				ActivePageView = undefined
				ReportStageFailure("Page View", error)
			}
		}

		// Subscribe immediately. Navigation must never wait on us having found a
		// container, otherwise pressing the playbar button appears to do nothing.
		ViewMaid.Give(SpotifyHistory.listen(HandleSpotifyLocation))
		HandleSpotifyLocation(SpotifyHistory.location)
	}
)
.catch( // Navigation is the most important stage, so never let it be skipped
	error => ReportStageFailure("Location Handler", error)
)
.then( // Spotify Fullscreen Button Removal
	() => {
		const HideFullscreenButton = (controlsContainer: Element) => {
			for (const element of controlsContainer.children) {
				if (
					(element.getAttribute("data-testid") === "fullscreen-mode-button"
					 || element.getAttribute("data-sub-component") === "fullscreen-button"
					 || element.getAttribute("aria-label")?.toLowerCase().includes("fullscreen"))
					&& (element.id !== "BeautifulLyricsFullscreenButton")
				) {
					(element as HTMLElement).style.display = "none"
				}
			}
		}

		let attempts = 0
		const SearchDOM = () => {
			const controlsContainer = document.querySelector<HTMLElement>(".main-nowPlayingBar-extraControls")
			if (controlsContainer === null) {
				if (++attempts < 50) {
					ViewMaid.Give(Defer(SearchDOM), "FullscreenButtonRemoval")
				}
			} else {
				HideFullscreenButton(controlsContainer)
				const observer = ViewMaid.Give(new MutationObserver(() => HideFullscreenButton(controlsContainer)))
				observer.observe(controlsContainer, { childList: true, subtree: true })
			}
		}
		SearchDOM()
	}
)
.catch(
	error => ReportStageFailure("Spotify Fullscreen Button Removal", error)
)