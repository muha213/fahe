// External Lyric Provider Functions

// Lyrics Types
import type { LineVocal, Lyrics as ProviderLyrics, SyllableMetadata, SyllableVocalSet } from "@Universal/Types/Lyrics.ts"

// Diacritic stripping for romanization
import { stripDiacritics } from "./LyricUtilities.ts"

// Spicetify Services (only needed for Spotify native API)
import { SpotifyRequestBuilder } from "../Session.ts"

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

// Convert word-level JSON array (Deezer/Kugou format) to Syllable lyrics
const convertWordArrayToSyllable = (lyrics: any[]): ProviderLyrics | undefined => {
	const content: SyllableVocalSet[] = []
	for (const line of lyrics) {
		const words = line?.text
		if (Array.isArray(words) === false || words.length === 0) continue
		const syllables: SyllableMetadata[] = []
		for (const w of words) {
			if (w.text === undefined || w.timestamp === undefined || w.endtime === undefined) continue
			if (w.endtime <= w.timestamp) continue
			syllables.push({
				Text: w.text,
				StartTime: w.timestamp / 1000,
				EndTime: w.endtime / 1000,
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

// Try multiple parsing strategies on a paxsenix JSON response
const parsePaxsenixResponse = (parsed: any, durationSeconds?: number): ProviderLyrics | undefined => {
	if (parsed === undefined || parsed === null) return undefined

	// Try to find lyrics text in various field names
	const possibleText = parsed.lyrics ?? parsed.plain_lyrics ?? parsed.plainLyrics ?? parsed.lyrics_body ?? (typeof parsed === "string" ? parsed : undefined)

	if (typeof possibleText === "string" && possibleText.length > 0) {
		return convertEnhancedLrcToSyllableLyrics(possibleText, durationSeconds)
			?? convertLrcToLineLyrics(possibleText, durationSeconds)
			?? convertPlainTextToStatic(possibleText)
	}

	// Try word-level array (like Deezer/Kugou format)
	if (Array.isArray(parsed.lyrics) && parsed.lyrics.length > 0) {
		return convertWordArrayToSyllable(parsed.lyrics)
	}
	if (Array.isArray(parsed.data) && parsed.data.length > 0) {
		return convertWordArrayToSyllable(parsed.data)
	}

	// Try nested data.lyrics
	if (parsed.data && typeof parsed.data === "object") {
		const dataText = parsed.data.lyrics ?? parsed.data.plain_lyrics ?? parsed.data.plainLyrics
		if (typeof dataText === "string" && dataText.length > 0) {
			return convertEnhancedLrcToSyllableLyrics(dataText, durationSeconds)
				?? convertLrcToLineLyrics(dataText, durationSeconds)
				?? convertPlainTextToStatic(dataText)
		}
		if (Array.isArray(parsed.data.lyrics)) {
			return convertWordArrayToSyllable(parsed.data.lyrics)
		}
	}

	return undefined
}

const convertEnhancedLrcToSyllableLyrics = (enhancedLrc: string | undefined | null, durationSeconds?: number): ProviderLyrics | undefined => {
	if (enhancedLrc === undefined || enhancedLrc === null || enhancedLrc.trim().length === 0) return undefined

	const lineTimestampPattern = /^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/
	const wordTimestampPattern = /<(\d{1,2}:\d{2}(?:\.\d{1,3})?)>/g

	type TimedPart = { time: number; text: string }
	const parsedLines: Array<{ lineTime: number; parts: TimedPart[] }> = []

	for (const rawLine of enhancedLrc.split(/\r?\n/)) {
		const lineMatch = lineTimestampPattern.exec(rawLine.trim())
		if (lineMatch === null) continue
		const lineTime = parseLrcTimestamp(lineMatch[1]!)
		if (lineTime === undefined) continue

		const body = rawLine.slice(lineMatch[0].length)
		const matches = [...body.matchAll(wordTimestampPattern)]
		if (matches.length === 0) continue

		const parts: TimedPart[] = []
		for (let i = 0; i < matches.length; i++) {
			const time = parseLrcTimestamp(matches[i][1]!)
			if (time === undefined) continue
			const textStart = (matches[i].index ?? 0) + matches[i][0].length
			const textEnd = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length
			const text = body.slice(textStart, textEnd).replace(/\s+/g, " ").trim()
			if (text.length > 0) parts.push({ time, text })
		}
		if (parts.length > 0) parsedLines.push({ lineTime, parts })
	}

	parsedLines.sort((a, b) => a.lineTime - b.lineTime)
	if (parsedLines.length === 0) return undefined

	const content: SyllableVocalSet[] = []
	for (let li = 0; li < parsedLines.length; li++) {
		const line = parsedLines[li]
		const nextLine = parsedLines[li + 1]
		const lineEndTime = Math.max(line.lineTime, nextLine?.lineTime ?? (durationSeconds ?? line.lineTime + 5))

		const syllables: SyllableMetadata[] = []
		for (let pi = 0; pi < line.parts.length; pi++) {
			const part = line.parts[pi]
			const nextPart = line.parts[pi + 1]
			syllables.push({
				Text: part.text,
				StartTime: part.time,
				EndTime: Math.max(part.time, nextPart?.time ?? lineEndTime),
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
	return {
		Type: "Syllable",
		StartTime: content[0].Lead.StartTime,
		EndTime: content[content.length - 1].Lead.EndTime,
		Content: content
	}
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

// Provider 1: AMLLDB TTML syllable lyrics
export const FetchAMLLDBLyrics = (trackId: string): Promise<ProviderLyrics | undefined> => {
	return (
		fetch(`https://amll-ttml-db.stevexmh.net/spotify/${encodeURIComponent(trackId)}?format=ttml`, {
			headers: { Accept: "application/xml, text/xml, text/plain;q=0.9", "User-Agent": "BeautifulLyrics/1.0" }
		})
		.then(r => r.ok === false ? undefined : r.text())
		.then(text => text === undefined ? undefined : convertTtmlToSyllableLyrics(text))
		.catch(() => undefined)
	)
}

// Provider 2: Paxsenix Musixmatch word-level syllable lyrics
export const FetchMusixmatchLyrics = (trackId: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://lyrics.paxsenix.org/musixmatch/lyrics?id=${encodeURIComponent(trackId)}&type=word&format=json`
	return (
		fetch(url, { headers: { Accept: "application/json", "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.text())
		.then(text => {
			if (text === undefined) return undefined
			let parsed: any
			try { parsed = JSON.parse(text) } catch { return convertEnhancedLrcToSyllableLyrics(text) ?? convertLrcToLineLyrics(text) ?? convertPlainTextToStatic(text) }
			return parsePaxsenixResponse(parsed)
		})
		.catch(() => undefined)
	)
}

// Provider 3: Paxsenix Musixmatch search by artist+title (better for non-English songs)
export const FetchMusixmatchSearchLyrics = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://lyrics.paxsenix.org/musixmatch/lyrics?t=${encodeURIComponent(title)}&a=${encodeURIComponent(artist)}&type=word&format=json`
	return (
		fetch(url, { headers: { Accept: "application/json", "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.text())
		.then(text => {
			if (text === undefined) return undefined
			let parsed: any
			try { parsed = JSON.parse(text) } catch { return convertEnhancedLrcToSyllableLyrics(text) ?? convertLrcToLineLyrics(text) ?? convertPlainTextToStatic(text) }
			return parsePaxsenixResponse(parsed)
		})
		.catch(() => undefined)
	)
}

// Provider 4: LRCLIB search
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

// Provider 4b: LRCLIB lookup by ISRC
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

// Provider 5: Paxsenix Genius static lyrics
export const FetchGeniusLyrics = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const query = `${title} ${artist}`
	return (
		fetch(`https://genius.com/api/search/song?q=${encodeURIComponent(query)}`, {
			headers: { Accept: "application/json", "User-Agent": "BeautifulLyrics/1.0" }
		})
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			const hits = data?.response?.sections?.flatMap((s: any) => s.hits ?? []) ?? []
			const match = hits.find((hit: any) => {
				const r = hit?.result
				return r?.url !== undefined
			})
			return match?.result?.url
		})
		.then((url: string | undefined) => {
			if (url === undefined) return undefined
			return fetch(`https://lyrics.paxsenix.org/genius/lyrics?url=${encodeURIComponent(url)}`, {
				headers: { "User-Agent": "BeautifulLyrics/1.0" }
			})
		})
		.then(r => r?.ok === false || r === undefined ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined || data?.error === true) return undefined
			if (typeof data.lyrics === "string") return convertPlainTextToStatic(data.lyrics)
			return undefined
		})
		.catch(() => undefined)
	)
}

// Provider 6: Spotify color-lyrics via internal RequestBuilder
export const FetchDirectSpotifyLyrics = (songId: string, internalId: string): Promise<ProviderLyrics | undefined> => {
	const builder = (
		SpotifyRequestBuilder.build()
		.withHost("https://spclient.wg.spotify.com/color-lyrics/v2")
		.withPath(`/track/${internalId}?format=json&vocalRemoval=false&market=from_token`)
	)

	return (
		(builder.send() as Promise<any>)
		.then(response => {
			if (response?.ok === false) return undefined
			const lyrics = response?.body?.lyrics
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

// Provider 7: Paxsenix Deezer word-level lyrics
export const FetchDeezerLyrics = (artist: string, title: string, duration?: number): Promise<ProviderLyrics | undefined> => {
	const query = `${title} ${artist}`
	const normalize = (v: string) => v.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "")

	return (
		fetch(`https://api.deezer.com/search/track?q=${encodeURIComponent(query)}`, {
			headers: { Accept: "application/json", "User-Agent": "BeautifulLyrics/1.0" }
		})
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			const songs = data?.data ?? []
			if (Array.isArray(songs) === false || songs.length === 0) return undefined

			const normalizedTitle = normalize(title)
			const normalizedArtist = normalize(artist)

			const match = songs.find((s: any) => {
				if (s.id === undefined) return false
				if (duration !== undefined && s.duration !== undefined) {
					if (Math.abs(s.duration - duration) > 10) return false
				}
				const st = normalize(s.title ?? "")
				const sa = normalize(s.artist?.name ?? "")
				return st.includes(normalizedTitle) && sa.includes(normalizedArtist)
			})

			return match?.id !== undefined ? String(match.id) : undefined
		})
		.then((deezerId: string | undefined) => {
			if (deezerId === undefined) return undefined
			return fetch(`https://lyrics.paxsenix.org/deezer/lyrics?id=${deezerId}`, {
				headers: { "User-Agent": "BeautifulLyrics/1.0" }
			})
		})
		.then(r => r?.ok === false || r === undefined ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined || data?.isError === true) return undefined

			if (Array.isArray(data.lyrics) && data.lyrics.length > 0) {
				return convertWordArrayToSyllable(data.lyrics)
			}

			if (typeof data.plain_lyrics === "string" && data.plain_lyrics.length > 0) {
				return convertPlainTextToStatic(data.plain_lyrics)
			}

			return parsePaxsenixResponse(data)
		})
		.catch(() => undefined)
	)
}

// Provider 8: Paxsenix YouTube line lyrics
export const FetchYouTubeLyrics = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const query = `${title} ${artist}`
	return (
		fetch(`https://lyrics.paxsenix.org/youtube/search?q=${encodeURIComponent(query)}`, {
			headers: { "User-Agent": "BeautifulLyrics/1.0" }
		})
		.then(r => r.ok === false ? undefined : r.json())
		.then((videos: any) => {
			if (Array.isArray(videos) === false || videos.length === 0) return undefined
			const video = videos[0]
			return video?.videoId
		})
		.then((videoId: string | undefined) => {
			if (videoId === undefined) return undefined
			return fetch(`https://lyrics.paxsenix.org/youtube/lyrics?id=${videoId}`, {
				headers: { "User-Agent": "BeautifulLyrics/1.0" }
			})
		})
		.then(r => r?.ok === false || r === undefined ? undefined : r.text())
		.then(text => {
			if (text === undefined) return undefined
			let parsed: any
			try { parsed = JSON.parse(text) } catch { return convertLrcToLineLyrics(text) ?? convertPlainTextToStatic(text) }
			if (parsed && typeof parsed === "object") {
				const possibleText = parsed.lyrics ?? parsed.plain_lyrics
				if (typeof possibleText === "string") return convertLrcToLineLyrics(possibleText) ?? convertPlainTextToStatic(possibleText)
			}
			return undefined
		})
		.catch(() => undefined)
	)
}

// Provider 9: Paxsenix Netease line lyrics
export const FetchNeteaseLyrics = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const query = `${title} ${artist}`
	return (
		fetch(`https://lyrics.paxsenix.org/netease/search?q=${encodeURIComponent(query)}`, {
			headers: { "User-Agent": "BeautifulLyrics/1.0" }
		})
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			const songs = data?.result?.songs ?? data?.songs ?? []
			if (Array.isArray(songs) === false || songs.length === 0) return undefined
			return String(songs[0].id)
		})
		.then((neteaseId: string | undefined) => {
			if (neteaseId === undefined) return undefined
			return fetch(`https://lyrics.paxsenix.org/netease/lyrics?id=${neteaseId}`, {
				headers: { "User-Agent": "BeautifulLyrics/1.0" }
			})
		})
		.then(r => r?.ok === false || r === undefined ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined || data?.error === true) return undefined
			return parsePaxsenixResponse(data)
		})
		.catch(() => undefined)
	)
}

// Provider 10: Paxsenix QQ Music line lyrics
export const FetchQQMusicLyrics = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const query = `${title} ${artist}`
	return (
		fetch(`https://lyrics.paxsenix.org/qq/search?q=${encodeURIComponent(query)}`, {
			headers: { "User-Agent": "BeautifulLyrics/1.0" }
		})
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			const songs = data?.result?.songs ?? data?.songs ?? []
			if (Array.isArray(songs) === false || songs.length === 0) return undefined
			return String(songs[0].id ?? songs[0].songid)
		})
		.then((qqId: string | undefined) => {
			if (qqId === undefined) return undefined
			return fetch(`https://lyrics.paxsenix.org/qq/lyrics?id=${qqId}`, {
				headers: { "User-Agent": "BeautifulLyrics/1.0" }
			})
		})
		.then(r => r?.ok === false || r === undefined ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined || data?.error === true) return undefined
			return parsePaxsenixResponse(data)
		})
		.catch(() => undefined)
	)
}

// Provider 12: BetterLyrics API - TTML (word-level timing)
export const FetchBetterLyricsTTML = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://lyrics-api.boidu.dev/getLyrics?s=${encodeURIComponent(title)}&a=${encodeURIComponent(artist)}`
	return (
		fetch(url, { headers: { Accept: "application/json", "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined) return undefined
			const ttml: unknown = data.ttml
			if (typeof ttml !== "string" || ttml.length === 0) return undefined
			return convertTtmlToSyllableLyrics(ttml)
		})
		.catch(() => undefined)
	)
}

// Provider 13: BetterLyrics API - Kugou (line-level timing)
export const FetchBetterLyricsKugou = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://lyrics-api.boidu.dev/kugou/getLyrics?s=${encodeURIComponent(title)}&a=${encodeURIComponent(artist)}`
	return (
		fetch(url, { headers: { Accept: "application/json", "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined) return undefined
			const lyrics: unknown = data.lyrics
			if (typeof lyrics !== "string" || lyrics.length === 0) return undefined
			return convertLrcToLineLyrics(lyrics) ?? convertPlainTextToStatic(lyrics)
		})
		.catch(() => undefined)
	)
}

// Provider 14: BetterLyrics API - Legacy (line-level timing)
export const FetchBetterLyricsLegacy = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://lyrics-api.boidu.dev/legacy/getLyrics?s=${encodeURIComponent(title)}&a=${encodeURIComponent(artist)}`
	return (
		fetch(url, { headers: { Accept: "application/json", "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined) return undefined
			const lyrics: unknown = data.lyrics
			if (typeof lyrics !== "string" || lyrics.length === 0) return undefined
			return convertLrcToLineLyrics(lyrics) ?? convertPlainTextToStatic(lyrics)
		})
		.catch(() => undefined)
	)
}

// Provider 15: BetterLyrics API - QQ (line-level timing)
export const FetchBetterLyricsQQ = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const url = `https://lyrics-api.boidu.dev/qq/getLyrics?s=${encodeURIComponent(title)}&a=${encodeURIComponent(artist)}`
	return (
		fetch(url, { headers: { Accept: "application/json", "User-Agent": "BeautifulLyrics/1.0" } })
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined) return undefined
			const lyrics: unknown = data.lyrics
			if (typeof lyrics !== "string" || lyrics.length === 0) return undefined
			return convertLrcToLineLyrics(lyrics) ?? convertPlainTextToStatic(lyrics)
		})
		.catch(() => undefined)
	)
}

// Provider 16: BetterLyrics Unison - syllable (TTML) via unison.boidu.dev
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

// Provider 11B: BiniLyrics (syllable) via LyricsPlus API
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

// Provider 11: Paxsenix Kugou word-level lyrics
export const FetchKugouLyrics = (artist: string, title: string): Promise<ProviderLyrics | undefined> => {
	const query = `${title} ${artist}`
	return (
		fetch(`https://lyrics.paxsenix.org/kugou/search?q=${encodeURIComponent(query)}`, {
			headers: { "User-Agent": "BeautifulLyrics/1.0" }
		})
		.then(r => r.ok === false ? undefined : r.json())
		.then((data: any) => {
			const songs = data?.data ?? data?.songs ?? []
			if (Array.isArray(songs) === false || songs.length === 0) return undefined
			return String(songs[0].id ?? songs[0].hash)
		})
		.then((kugouId: string | undefined) => {
			if (kugouId === undefined) return undefined
			return fetch(`https://lyrics.paxsenix.org/kugou/lyrics?id=${kugouId}&word=true`, {
				headers: { "User-Agent": "BeautifulLyrics/1.0" }
			})
		})
		.then(r => r?.ok === false || r === undefined ? undefined : r.json())
		.then((data: any) => {
			if (data === undefined || data?.error === true) return undefined
			return parsePaxsenixResponse(data)
		})
		.catch(() => undefined)
	)
}
