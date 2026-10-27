// External Lyric Provider Functions

// Lyrics Types
import type { LineVocal, Lyrics as ProviderLyrics, SyllableMetadata, SyllableVocalSet } from "@Universal/Types/Lyrics.ts"

// Diacritic stripping for romanization
import { stripDiacritics } from "./LyricUtilities.ts"

// Spicetify Services (for Spotify native API)
import { SpotifyRequestBuilder, SpotifyInternalFetch, SpotifyFetch } from "../Session.ts"

// Helper type for LRC timestamp parsing
type LrcLine = { time: number; text: string }

const parseLrcTimestamp = (timestamp: string): number | undefined => {
	const match = /^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(timestamp)
	if (match === null) return undefined
	return Number(match[1]) * 60 + Number(match[2]) + Number((match[3] ?? "0").padEnd(3, "0")) / 1000
}

const convertLrcToLineLyrics = (lrc: string | undefined | null, durationSeconds?: number): ProviderLyrics | undefined => {
	if (lrc === undefined || lrc === null) return undefined

	const parsedLines: LrcLine[] = []
	const timestampPattern = /\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/g

	for (const rawLine of lrc.split(/\r?\n/)) {
		const timestamps = [...rawLine.matchAll(timestampPattern)]
		if (timestamps.length === 0) continue
		const text = rawLine.replace(timestampPattern, "").trim()
		if (text.length === 0) continue
		for (const ts of timestamps) {
			const time = parseLrcTimestamp(ts[1]!)
			if (time !== undefined) parsedLines.push({ time, text })
		}
	}

	parsedLines.sort((a, b) => a.time - b.time)
	if (parsedLines.length === 0) return undefined

	const content: LineVocal[] = parsedLines.map((line, index) => {
		const nextLine = parsedLines[index + 1]
		const fallbackEndTime = durationSeconds ?? line.time + 5
		return {
			Type: "Vocal",
			Text: line.text,
			StartTime: line.time,
			EndTime: Math.max(line.time, nextLine?.time ?? fallbackEndTime),
			OppositeAligned: false
		}
	})

	return {
		Type: "Line",
		StartTime: content[0].StartTime,
		EndTime: content[content.length - 1].EndTime,
		Content: content
	}
}

const convertPlainTextToStatic = (text: string | undefined | null): ProviderLyrics | undefined => {
	if (text === undefined || text === null) return undefined
	const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0).map(l => ({ Text: l }))
	if (lines.length === 0) return undefined
	return { Type: "Static", Lines: lines }
}

const parseTtmlTime = (value: string | undefined): number | undefined => {
	if (value === undefined || value.length === 0) return undefined

	const clockMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(value)
	if (clockMatch !== null) {
		const h = Number(clockMatch[1]); const m = Number(clockMatch[2])
		const s = clockMatch[3] === undefined ? undefined : Number(clockMatch[3])
		const ms = Number((clockMatch[4] ?? "0").padEnd(3, "0"))
		return s === undefined ? (h * 60 + m + ms / 1000) : (h * 3600 + m * 60 + s + ms / 1000)
	}

	const secs = /^(\d+(?:\.\d+)?)s$/.exec(value)
	if (secs?.[1] !== undefined) return Number(secs[1])
	return undefined
}

const convertTtmlToSyllableLyrics = (ttml: string | undefined | null): ProviderLyrics | undefined => {
	if (ttml === undefined || ttml === null || ttml.trim().length === 0) return undefined

	const spanPattern = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi
	const attrPattern = /\b([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g
	const tagPattern = /<[^>]+>/g

	const decodeXml = (v: string) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")

	const pElements = ttml.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi)
	if (pElements === null || pElements.length === 0) return undefined

	const content: SyllableVocalSet[] = []
	for (const pEl of pElements) {
		const spanMatches = [...pEl.matchAll(spanPattern)]
		type ParsedSpan = { text: string; attrs: Map<string, string> }
		const parsed: ParsedSpan[] = []
		for (const match of spanMatches) {
			const rawAttrs = match[1]; const rawText = match[2]
			if (rawAttrs === undefined || rawText === undefined) continue
			const text = decodeXml(rawText.replace(tagPattern, "")).trim()
			if (text.length === 0) continue
			const attrs = new Map<string, string>()
			for (const a of rawAttrs.matchAll(attrPattern)) {
				if (a[1] !== undefined && a[2] !== undefined) attrs.set(a[1], decodeXml(a[2]))
			}
			parsed.push({ text, attrs })
		}

		// Pair x-roman spans with their preceding primary span
		const primarySpans: Array<{ text: string; attrs: Map<string, string>; romanText?: string }> = []
		for (let i = 0; i < parsed.length; i++) {
			const span = parsed[i]
			const role = span.attrs.get("ttm:role")
			if (role === "x-bg" || role === "x-translation") continue
			if (role === "x-roman") {
				// Attach to the last primary span
				const last = primarySpans[primarySpans.length - 1]
				if (last !== undefined) last.romanText = stripDiacritics(span.text)
				continue
			}
			const sTime = parseTtmlTime(span.attrs.get("begin"))
			const eTime = parseTtmlTime(span.attrs.get("end"))
			if (sTime === undefined || eTime === undefined || eTime <= sTime) continue
			primarySpans.push({ text: span.text, attrs: span.attrs })
			// Check if next parsed span is x-roman at same position
			if (i + 1 < parsed.length && parsed[i + 1].attrs.get("ttm:role") === "x-roman") {
				const nextText = parsed[i + 1].text
				if (nextText.length > 0) primarySpans[primarySpans.length - 1].romanText = stripDiacritics(nextText)
				i++ // skip the x-roman span
			}
		}

		if (primarySpans.length === 0) continue
		const syllables: SyllableMetadata[] = []
		for (const span of primarySpans) {
			const sTime = parseTtmlTime(span.attrs.get("begin"))
			const eTime = parseTtmlTime(span.attrs.get("end"))
			if (sTime === undefined || eTime === undefined || eTime <= sTime) continue
			const syl: SyllableMetadata = { Text: span.text, StartTime: sTime, EndTime: eTime, IsPartOfWord: false }
			if (span.romanText !== undefined) syl.RomanizedText = stripDiacritics(span.romanText)
			syllables.push(syl)
		}

		if (syllables.length === 0) continue
		const first = syllables[0]; const last = syllables[syllables.length - 1]
		if (first === undefined || last === undefined) continue

		content.push({
			Type: "Vocal",
			OppositeAligned: false,
			Lead: { StartTime: first.StartTime, EndTime: last.EndTime, Syllables: syllables }
		})
	}

	if (content.length === 0) return undefined
	return {
		Type: "Syllable",
		StartTime: content[0].Lead.StartTime,
		EndTime: content[content.length - 1].Lead.EndTime,
		Content: content
	}
}

// Provider: LRCLIB search (supports CORS: access-control-allow-origin: *)
export const FetchLRCLIBLyrics = (artist: string, title: string, duration?: number): Promise<ProviderLyrics | undefined> => {
	const params = new URLSearchParams({ artist_name: artist, track_name: title })
	if (duration !== undefined) params.set("duration", String(Math.round(duration)))
	return (
		fetch(`https://lrclib.net/api/search?${params.toString()}`, { headers: { "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			if (Array.isArray(data) === false || data.length === 0) return undefined
			const result = data[0]
			if (result.instrumental === true) return undefined
			if (typeof result.syncedLyrics === "string" && result.syncedLyrics.length > 0) {
				return convertLrcToLineLyrics(result.syncedLyrics, duration) ?? convertPlainTextToStatic(result.syncedLyrics)
			}
			if (typeof result.plainLyrics === "string" && result.plainLyrics.length > 0) {
				return convertPlainTextToStatic(result.plainLyrics)
			}
			return undefined
		})
		.catch(() => undefined)
	)
}

// Provider: LRCLIB lookup by ISRC (supports CORS)
export const FetchLRCLIBByISRC = (isrc: string): Promise<ProviderLyrics | undefined> => {
	return (
		fetch(`https://lrclib.net/api/get?isrc=${encodeURIComponent(isrc)}`, { headers: { "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then((result: any) => {
			if (result === undefined || result === null) return undefined
			if (result.instrumental === true) return undefined
			if (typeof result.syncedLyrics === "string" && result.syncedLyrics.length > 0) {
				return convertLrcToLineLyrics(result.syncedLyrics, result.duration) ?? convertPlainTextToStatic(result.syncedLyrics)
			}
			if (typeof result.plainLyrics === "string" && result.plainLyrics.length > 0) {
				return convertPlainTextToStatic(result.plainLyrics)
			}
			return undefined
		})
		.catch(() => undefined)
	)
}

// Provider: Spotify color-lyrics via internal RequestBuilder or CosmosAsync/Fetch fallback
export const FetchDirectSpotifyLyrics = (songId: string, internalId: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${internalId}?format=json&vocalRemoval=false&market=from_token`
	let fetchPromise: Promise<any>
	if (SpotifyRequestBuilder !== undefined) {
		const builder = (
			SpotifyRequestBuilder.build()
			.withHost("https://spclient.wg.spotify.com/color-lyrics/v2")
			.withPath(`/track/${internalId}?format=json&vocalRemoval=false&market=from_token`)
		)
		fetchPromise = (builder.send() as Promise<any>).then(r => r?.ok === false ? undefined : (r?.body ?? r))
	} else if (SpotifyInternalFetch !== undefined) {
		fetchPromise = SpotifyInternalFetch.get(url).catch(() => undefined)
	} else {
		fetchPromise = SpotifyFetch(url).then(r => r.ok ? r.json() : undefined).catch(() => undefined)
	}

	return (
		fetchPromise
		.then((response): ProviderLyrics | undefined => {
			if (response === undefined || response?.ok === false) return undefined
			const lyrics = response?.lyrics ?? response?.body?.lyrics
			if (lyrics === undefined) return undefined

			const lines = lyrics.lines
			if (Array.isArray(lines) === false || lines.length === 0) return undefined

			if (lyrics.syncType === "LINE_SYNCED") {
				const content: LineVocal[] = []
				for (const line of lines) {
					const sTime = parseInt(line.startTimeMs) / 1000
					const eTime = parseInt(line.endTimeMs) / 1000
					if (isNaN(sTime) || isNaN(eTime)) continue
					content.push({
						Type: "Vocal",
						StartTime: sTime,
						EndTime: eTime,
						Text: line.words,
						OppositeAligned: false
					})
				}
				if (content.length === 0) return undefined
				return {
					Type: "Line",
					StartTime: content[0].StartTime,
					EndTime: content[content.length - 1].EndTime,
					Content: content
				}
			}

			if (lyrics.syncType === "UNSYNCED") {
				const staticLines = lines
					.filter((l: any) => typeof l.words === "string")
					.map((l: any) => ({ Text: l.words }))
				if (staticLines.length === 0) return undefined
				return { Type: "Static", Lines: staticLines }
			}

			return undefined
		})
		.catch(() => undefined)
	)
}

// Provider: Lyrics.ovh static lyrics (supports CORS: access-control-allow-origin: *)
export const FetchLyricsOvh = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
	return (
		fetch(url, { headers: { "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined || data?.error) return undefined
			if (typeof data.lyrics === "string" && data.lyrics.length > 0) {
				return convertPlainTextToStatic(data.lyrics)
			}
			return undefined
		})
		.catch(() => undefined)
	)
}

// Provider: BetterLyrics Unison - syllable (TTML) / line (LRC) via unison.boidu.dev (supports CORS)
const fetchUnisonByFormat = (artist: string, title: string, targetFormat: "ttml" | "lrc"): Promise<ProviderLyrics | undefined> => {
	const query = `${title} ${artist}`
	const searchUrl = `https://unison.boidu.dev/lyrics/search?q=${encodeURIComponent(query)}`

	return (
		fetch(searchUrl, { headers: { "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then((searchData: any) => {
			if (searchData?.success !== true || Array.isArray(searchData?.data) === false) return undefined

			const candidates = searchData.data
				.filter((r: any) => r.format === targetFormat && typeof r.id === "number")
				.sort((a: any, b: any) => (b.matchScore ?? 0) - (a.matchScore ?? 0))

			if (candidates.length === 0) return undefined
			return candidates[0].id as number
		})
		.then((id: number | undefined) => {
			if (id === undefined) return undefined
			return fetch(`https://unison.boidu.dev/lyrics/${id}`, {
				headers: { "User-Agent": "BeautifulLyrics/1.0" }
			})
		})
		.then(r => r?.ok === false || r === undefined ? undefined : r.json())
		.then((lyricsData: any) => {
			if (lyricsData?.success !== true) return undefined
			const lyrics: unknown = lyricsData?.data?.lyrics
			if (typeof lyrics !== "string" || lyrics.length === 0) return undefined

			if (targetFormat === "ttml") return convertTtmlToSyllableLyrics(lyrics)
			return convertLrcToLineLyrics(lyrics) ?? convertPlainTextToStatic(lyrics)
		})
		.catch(() => undefined)
	)
}

export const FetchBetterLyricsUnison = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	return fetchUnisonByFormat(artist, title, "ttml")
}

export const FetchBetterLyricsUnisonLine = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	return fetchUnisonByFormat(artist, title, "lrc")
}

// Provider: BiniLyrics (syllable/line) via LyricsPlus API (supports CORS: access-control-allow-origin: *)
const convertLyricsPlusToSyllable = (data: any): ProviderLyrics | undefined => {
	if (data?.type !== "Word" || Array.isArray(data?.lyrics) === false || data.lyrics.length === 0) return undefined
	const content: SyllableVocalSet[] = []
	for (const line of data.lyrics) {
		if (Array.isArray(line?.syllabus) === false || line.syllabus.length === 0) continue
		const syllables: SyllableMetadata[] = []
		for (const w of line.syllabus) {
			if (typeof w.text !== "string" || typeof w.time !== "number" || typeof w.duration !== "number") continue
			if (w.duration <= 0) continue
			syllables.push({
				Text: w.text,
				StartTime: w.time / 1000,
				EndTime: (w.time + w.duration) / 1000,
				IsPartOfWord: false
			})
		}
		if (syllables.length === 0) continue
		const first = syllables[0]; const last = syllables[syllables.length - 1]
		if (first === undefined || last === undefined) continue
		content.push({
			Type: "Vocal",
			OppositeAligned: false,
			Lead: { StartTime: first.StartTime, EndTime: last.EndTime, Syllables: syllables }
		})
	}
	if (content.length === 0) return undefined
	return { Type: "Syllable", StartTime: content[0].Lead.StartTime, EndTime: content[content.length - 1].Lead.EndTime, Content: content }
}

const convertLyricsPlusToLine = (data: any): ProviderLyrics | undefined => {
	if (data?.type !== "Word" || Array.isArray(data?.lyrics) === false || data.lyrics.length === 0) return undefined
	const content: LineVocal[] = []
	for (const line of data.lyrics) {
		if (typeof line.text !== "string" || typeof line.time !== "number" || typeof line.duration !== "number") continue
		if (line.duration <= 0) continue
		content.push({
			Type: "Vocal",
			Text: line.text,
			StartTime: line.time / 1000,
			EndTime: (line.time + line.duration) / 1000,
			OppositeAligned: false
		})
	}
	if (content.length === 0) return undefined
	return { Type: "Line", StartTime: content[0].StartTime, EndTime: content[content.length - 1].EndTime, Content: content }
}

export const FetchBiniLyricsLine = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://lyricsplus.binimum.org/v2/lyrics/get?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`
	return (
		fetch(url, { headers: { "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then(data => convertLyricsPlusToLine(data))
		.catch(() => undefined)
	)
}

export const FetchBiniLyrics = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://lyricsplus.binimum.org/v2/lyrics/get?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`
	return (
		fetch(url, { headers: { "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then(data => convertLyricsPlusToSyllable(data))
		.catch(() => undefined)
	)
}
