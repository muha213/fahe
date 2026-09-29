// Shared Boundary Modules
import type {
	Lyrics as ProviderLyrics,
	TextMetadata
} from "@Universal/Types/Lyrics.ts"
export type { ProviderLyrics }

// Language Modules
import { franc } from "npm:franc@^6.2.0"
import Kuroshiro from "npm:@sglkc/kuroshiro@^1.0.1"
import * as KuromojiAnalyzer from "./KuromojiAnalyzer.ts"
import pinyin from "@Pinyin/Source/main.ts"
import Aromanize from "./Aromanize.ts"

// Lyrics Types
type NaturalAlignment = ("Right" | "Left")
export type RomanizedLanguage = ("Chinese" | "Japanese" | "Korean" | "Hindi" | "Punjabi")
type BaseInformation = {
	NaturalAlignment: NaturalAlignment;
	Language: string;
	RomanizedLanguage?: RomanizedLanguage;
}
export type TransformedLyrics = (
	BaseInformation
	& ProviderLyrics
)

// Behavior Constants
// Romanization separator ("" = spaces, "-" = hyphens, "." = dots)
let romanizationSeparator = ""
export const SetRomanizationSeparator = (sep: string): void => { romanizationSeparator = sep }

const MinimumInterludeDuration = 2
const EndInterludeEarlyBy = 0.25 // Seconds before our analytical end. This is used as a prep for the next vocal

// Language Recognition Constants
const RightToLeftLanguages = [
	// Persian
	'pes', 'urd',
	
	// Arabic Languages
	'arb', 'uig', // Do not include "zlm" (Malay), it is in Arabic script but it's not written right-to-left

	// Hebrew Languages
	'heb', 'ydd',

	// Mende Languages
	'men'
]

const RomajiConverter = new Kuroshiro()
const RomajiPromise = RomajiConverter.init(KuromojiAnalyzer)

const KoreanTextTest = /[\uac00-\ud7af]|[\u1100-\u11ff]|[\u3130-\u318f]|[\ua960-\ua97f]|[\ud7b0-\ud7ff]/
const ChineseTextText = /([\u4E00-\u9FFF])/
const JapaneseTextText = /([ぁ-んァ-ン])/
const DevanagariTextTest = /[\u0900-\u097F]/
const GurmukhiTextTest = /[\u0A00-\u0A7F]/

// Strip all diacritical marks (ā→a, ś→s, ṭ→t, etc.)
export const stripDiacritics = (text: string): string => (
	text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
)

// Helper Methods
const GetNaturalAlignment = (language: string): NaturalAlignment => {
	return (RightToLeftLanguages.includes(language) ? "Right" : "Left")
}

const GenerateChineseRomanization = <L extends TextMetadata>(
	lyricMetadata: L,
	primaryLanguage: string
): Promise<RomanizedLanguage | void> => {
	if ((primaryLanguage === "cmn") || ChineseTextText.test(lyricMetadata.Text)) {
		return (
				pinyin(
					lyricMetadata.Text,
					{
						segment: false,
						group: true,
						style: 0
					}
				)
			.then(result => lyricMetadata.RomanizedText = result.join("-"))
			.then(() => "Chinese")
		)
	} else {
		return Promise.resolve()
	}
}

const GenerateJapaneseRomanization = <L extends TextMetadata>(
	lyricMetadata: L,
	primaryLanguage: string
): Promise<RomanizedLanguage | void> => {
	if ((primaryLanguage === "jpn") || JapaneseTextText.test(lyricMetadata.Text)) {
		return (
			RomajiPromise.then(
				() => RomajiConverter.convert(
					lyricMetadata.Text,
					{
						to: "romaji",
						mode: "spaced"
					}
				)
			)
			.then(
				result => {
					lyricMetadata.RomanizedText = stripDiacritics(result)
					return "Japanese"
				}
			)
		)
	} else {
		return Promise.resolve()
	}
}

const GenerateKoreanRomanization = <L extends TextMetadata>(
	lyricMetadata: L,
	primaryLanguage: string
): Promise<RomanizedLanguage | void> => {
	if ((primaryLanguage === "kor") || KoreanTextTest.test(lyricMetadata.Text)) {
		lyricMetadata.RomanizedText = Aromanize(lyricMetadata.Text, "RevisedRomanizationTransliteration")
		return Promise.resolve("Korean")
	} else {
		return Promise.resolve()
	}
}

const DEVANAGARI = {
	cons: {
		'\u0915': 'k', '\u0916': 'kh', '\u0917': 'g', '\u0918': 'gh', '\u0919': 'n',
		'\u091a': 'ch', '\u091b': 'chh', '\u091c': 'j', '\u091d': 'jh', '\u091e': 'ny',
		'\u091f': 't', '\u0920': 'th', '\u0921': 'd', '\u0922': 'dh', '\u0923': 'n',
		'\u0924': 't', '\u0925': 'th', '\u0926': 'd', '\u0927': 'dh', '\u0928': 'n',
		'\u092a': 'p', '\u092b': 'ph', '\u092c': 'b', '\u092d': 'bh', '\u092e': 'm',
		'\u092f': 'y', '\u0930': 'r', '\u0932': 'l', '\u0933': 'l', '\u0935': 'v',
		'\u0936': 'sh', '\u0937': 'sh', '\u0938': 's', '\u0939': 'h',
		'\u0958': 'q', '\u0959': 'kh', '\u095a': 'g', '\u095b': 'z', '\u095c': 'r',
		'\u095d': 'rh', '\u095e': 'f', '\u095f': 'y',
	} as Record<string, string>,
	vowel: {
		'\u0905': 'a', '\u0906': 'a', '\u0907': 'i', '\u0908': 'i', '\u0909': 'u',
		'\u090a': 'u', '\u090b': 'ri', '\u090c': 'li', '\u090f': 'e', '\u0910': 'ai',
		'\u0913': 'o', '\u0914': 'au',
	} as Record<string, string>,
	matra: {
		'\u093e': 'a', '\u093f': 'i', '\u0940': 'i', '\u0941': 'u', '\u0942': 'u',
		'\u0943': 'ri', '\u0944': 'ri', '\u0947': 'e', '\u0948': 'ai',
		'\u094b': 'o', '\u094c': 'au',
	} as Record<string, string>,
	other: {
		'\u0901': 'n', '\u0902': 'n', '\u0903': 'h',
		'\u093c': 'h',
	} as Record<string, string>,
}

const DEV_LEFT_MATRA = new Set(['\u093f', '\u0940', '\u0947', '\u0948', '\u094b', '\u094c'])

const romanizeDevanagari = (text: string): string => {
	const HALANT = '\u094d'
	const WORD_BOUNDARY = new Set([' ', '\n', '\r', '\t', ',', '.', '!', '?', ';', ':', '"', "'", '(', ')', '[', ']'])
	const { cons, vowel, matra, other } = DEVANAGARI
	let out = '', pendingMatra = ''
	let i = 0
	while (i < text.length) {
		const ch = text[i]
		if (ch < '\u0900' || ch > '\u097f') {
			if (pendingMatra) { out += pendingMatra; pendingMatra = '' }
			out += ch; i++; continue
		}
		if (ch === '\u200c' || ch === '\u200d') { i++; continue }
		if (ch === HALANT) { i++; continue }
		if (vowel[ch] !== undefined) { if (pendingMatra) { out += pendingMatra; pendingMatra = '' } out += vowel[ch]; i++; continue }
		if (other[ch] !== undefined) { if (pendingMatra) { out += pendingMatra; pendingMatra = '' } out += other[ch]; i++; continue }
		if (DEV_LEFT_MATRA.has(ch)) {
			pendingMatra = matra[ch]; i++; continue
		}
		if (matra[ch] !== undefined) { out += matra[ch]; i++; continue }
		if (cons[ch] !== undefined) {
			if (pendingMatra) { out += pendingMatra; pendingMatra = '' }
			out += cons[ch]; i++
			while (i < text.length && text[i] === HALANT) {
				i++
				if (i < text.length && cons[text[i]]) { out += cons[text[i]]; i++ }
			}
			const next = text[i]
			if (i >= text.length || WORD_BOUNDARY.has(next)) {
			} else if (matra[next] !== undefined && !DEV_LEFT_MATRA.has(next)) {
				out += matra[next]; i++
			} else if (cons[next] !== undefined) {
				out += 'a'
			} else if (other[next] !== undefined) {
				out += 'a'; out += other[next]; i++
			} else if (next >= '\u0900' && next <= '\u097f') {
			} else {
				out += 'a'
			}
			continue
		}
		i++
	}
	if (pendingMatra) out += pendingMatra
	return out
}

const GURMUKHI = {
	cons: {
		'\u0a15': 'k', '\u0a16': 'kh', '\u0a17': 'g', '\u0a18': 'gh', '\u0a19': 'n',
		'\u0a1a': 'ch', '\u0a1b': 'chh', '\u0a1c': 'j', '\u0a1d': 'jh', '\u0a1e': 'n',
		'\u0a1f': 't', '\u0a20': 'th', '\u0a21': 'd', '\u0a22': 'dh', '\u0a23': 'n',
		'\u0a24': 't', '\u0a25': 'th', '\u0a26': 'd', '\u0a27': 'dh', '\u0a28': 'n',
		'\u0a2a': 'p', '\u0a2b': 'ph', '\u0a2c': 'b', '\u0a2d': 'bh', '\u0a2e': 'm',
		'\u0a2f': 'y', '\u0a30': 'r', '\u0a32': 'l', '\u0a33': 'l', '\u0a35': 'v',
		'\u0a36': 'sh', '\u0a38': 's', '\u0a39': 'h',
		'\u0a5c': 'r', '\u0a5e': 'f',
	} as Record<string, string>,
	vowel: {
		'\u0a05': 'a', '\u0a06': 'a', '\u0a07': 'i', '\u0a08': 'i', '\u0a09': 'u',
		'\u0a0a': 'u', '\u0a0f': 'e', '\u0a10': 'ai', '\u0a13': 'o', '\u0a14': 'au',
		'\u0a02': 'n', '\u0a01': 'n',
	} as Record<string, string>,
	matra: {
		'\u0a3e': 'a', '\u0a3f': 'i', '\u0a40': 'i', '\u0a41': 'u', '\u0a42': 'u',
		'\u0a47': 'e', '\u0a48': 'ai', '\u0a4b': 'o', '\u0a4c': 'au',
	} as Record<string, string>,
	other: {
		'\u0a70': 'n', '\u0a71': 'n', '\u0a03': 'h',
		'\u0a3c': 'h',
	} as Record<string, string>,
}

const GURMUKHI_HALANT = '\u0a4d'

const GUR_LEFT_MATRA = new Set(['\u0a3f', '\u0a47', '\u0a48', '\u0a4b', '\u0a4c'])

const romanizeGurmukhi = (text: string): string => {
	const WORD_BOUNDARY = new Set([' ', '\n', '\r', '\t', ',', '.', '!', '?', ';', ':', '"', "'", '(', ')', '[', ']'])
	const { cons, vowel, matra, other } = GURMUKHI
	let out = '', pendingMatra = ''
	let i = 0
	while (i < text.length) {
		const ch = text[i]
		if (ch < '\u0a00' || ch > '\u0a7f') {
			if (pendingMatra) { out += pendingMatra; pendingMatra = '' }
			out += ch; i++; continue
		}
		if (ch === '\u200c' || ch === '\u200d') { i++; continue }
		if (ch === GURMUKHI_HALANT) { i++; continue }
		if (vowel[ch] !== undefined) { if (pendingMatra) { out += pendingMatra; pendingMatra = '' } out += vowel[ch]; i++; continue }
		if (other[ch] !== undefined) { if (pendingMatra) { out += pendingMatra; pendingMatra = '' } out += other[ch]; i++; continue }
		if (GUR_LEFT_MATRA.has(ch)) {
			pendingMatra = matra[ch]; i++; continue
		}
		if (matra[ch] !== undefined) { out += matra[ch]; i++; continue }
		if (cons[ch] !== undefined) {
			if (pendingMatra) { out += pendingMatra; pendingMatra = '' }
			out += cons[ch]; i++
			while (i < text.length && text[i] === GURMUKHI_HALANT) {
				i++
				if (i < text.length && cons[text[i]]) { out += cons[text[i]]; i++ }
			}
			const next = text[i]
			if (i >= text.length || WORD_BOUNDARY.has(next)) {
			} else if (matra[next] !== undefined && !GUR_LEFT_MATRA.has(next)) {
				out += matra[next]; i++
			} else if (cons[next] !== undefined) {
				out += 'a'
			} else if (other[next] !== undefined) {
				out += 'a'; out += other[next]; i++
			} else if (next >= '\u0a00' && next <= '\u0a7f') {
			} else {
				out += 'a'
			}
			continue
		}
		i++
	}
	if (pendingMatra) out += pendingMatra
	return out
}

const HindiLanguageCodes = new Set([
	"hin", "san", "mar", "nep", "kok", "bho", "mai", "doi", "kas", "snd",
])

const GenerateHindiRomanization = <L extends TextMetadata>(
	lyricMetadata: L,
	primaryLanguage: string
): Promise<RomanizedLanguage | void> => {
	if (HindiLanguageCodes.has(primaryLanguage) || DevanagariTextTest.test(lyricMetadata.Text)) {
		const raw = romanizeDevanagari(lyricMetadata.Text)
		lyricMetadata.RomanizedText = romanizationSeparator ? raw.replace(/ /g, romanizationSeparator) : raw
		return Promise.resolve("Hindi")
	} else {
		return Promise.resolve()
	}
}

const GeneratePunjabiRomanization = <L extends TextMetadata>(
	lyricMetadata: L,
	primaryLanguage: string
): Promise<RomanizedLanguage | void> => {
	if (primaryLanguage === "pan" || GurmukhiTextTest.test(lyricMetadata.Text)) {
		const raw = romanizeGurmukhi(lyricMetadata.Text)
		lyricMetadata.RomanizedText = romanizationSeparator ? raw.replace(/ /g, romanizationSeparator) : raw
		return Promise.resolve("Punjabi")
	} else {
		return Promise.resolve()
	}
}

const GenerateRomanization = <L extends TextMetadata, I extends BaseInformation>(
	lyricMetadata: L,
	rootInformation: I
): Promise<void> => {
	// If romanization is already provided by the source (e.g. TTML x-roman), keep it as-is
	if (lyricMetadata.RomanizedText !== undefined && lyricMetadata.RomanizedText.length > 0) {
		return Promise.resolve()
	}
	return (
		GenerateJapaneseRomanization(lyricMetadata, rootInformation.Language)
		.then(
			(romanizedLanguage) => {
				if (romanizedLanguage === undefined) {
					return GenerateKoreanRomanization(lyricMetadata, rootInformation.Language)
				} else {
					return romanizedLanguage
				}
			}
		)
		.then(
			(romanizedLanguage) => {
				if (romanizedLanguage === undefined) {
					return GenerateChineseRomanization(lyricMetadata, rootInformation.Language)
				} else {
					return romanizedLanguage
				}
			}
		)
		.then(
			(romanizedLanguage) => {
				if (romanizedLanguage === undefined) {
					return GenerateHindiRomanization(lyricMetadata, rootInformation.Language)
				} else {
					return romanizedLanguage
				}
			}
		)
		.then(
			(romanizedLanguage) => {
				if (romanizedLanguage === undefined) {
					return GeneratePunjabiRomanization(lyricMetadata, rootInformation.Language)
				} else {
					return romanizedLanguage
				}
			}
		)
		.then(
			(romanizedLanguage) => {
				if (romanizedLanguage !== undefined) {
					rootInformation.RomanizedLanguage = romanizedLanguage
				}
			}
		)
	)
}

// Transformation Methods
export const TransformProviderLyrics = (providerLyrics: ProviderLyrics): Promise<TransformedLyrics> => {
	// Type-case for the future
	const lyrics = (providerLyrics as TransformedLyrics)

	// First, determine our language/natural-alignment and then romanize
	const romanizationPromises: Promise<void>[] = []
	if (lyrics.Type === "Static") {
		// Determine our language AND natural-alignment
		{
			// Put all our text together for processing
			let textToProcess = lyrics.Lines[0].Text
			for (let index = 1; index < lyrics.Lines.length; index += 1) {
				textToProcess += `\n${lyrics.Lines[index].Text}`
			}

			// Determine our language
			const language = franc(textToProcess)

			// Now update our natural alignment and language
			lyrics.Language = language
			lyrics.NaturalAlignment = GetNaturalAlignment(language)
		}

		// Go through and romanize everything
		for(const lyricMetadata of lyrics.Lines) {
			romanizationPromises.push(GenerateRomanization(lyricMetadata, lyrics))
		}
	} else if (lyrics.Type === "Line") {
		// Determine our language AND natural-alignment
		{
			// Put all our text together for processing
			const lines = []
			for (const vocalGroup of lyrics.Content) {
				if (vocalGroup.Type === "Vocal") {
					lines.push(vocalGroup.Text)
				}
			}
			const textToProcess = lines.join("\n") 

			// Determine our language
			const language = franc(textToProcess)

			// Now update our natural alignment and language
			lyrics.Language = language
			lyrics.NaturalAlignment = GetNaturalAlignment(language)
		}

		// Go through and romanize everything
		for(const vocalGroup of lyrics.Content) {
			if (vocalGroup.Type == "Vocal") {
				romanizationPromises.push(GenerateRomanization(vocalGroup, lyrics))
			}
		}
	} else if (lyrics.Type === "Syllable") {
		// Determine our language AND natural-alignment
		{
			// Put all our text together for processing
			const lines = []
			for (const vocalGroup of lyrics.Content) {
				if (vocalGroup.Type === "Vocal") {
					let text = vocalGroup.Lead.Syllables[0].Text
					for (let index = 1; index < vocalGroup.Lead.Syllables.length; index += 1) {
						const syllable = vocalGroup.Lead.Syllables[index]
						text += `${syllable.IsPartOfWord ? "" : " "}${syllable.Text}`
					}

					lines.push(text)
				}
			}
			const textToProcess = lines.join("\n") 

			// Determine our language
			const language = franc(textToProcess)

			// Now update our natural alignment and language
			lyrics.Language = language
			lyrics.NaturalAlignment = GetNaturalAlignment(language)
		}

		// Go through and romanize everything
		for(const vocalGroup of lyrics.Content) {
			if (vocalGroup.Type == "Vocal") {
				for(const syllable of vocalGroup.Lead.Syllables) {
					romanizationPromises.push(GenerateRomanization(syllable, lyrics))
				}

				if (vocalGroup.Background !== undefined) {
					for(const syllable of vocalGroup.Background[0].Syllables) {
						romanizationPromises.push(GenerateRomanization(syllable, lyrics))
					}
				}
			}
		}
	}

	return (
		// Wait for our romaniazation process to finish
		Promise.all(romanizationPromises)

		// Then add in interludes according to our preferences
		.then(
			() => {
				if (lyrics.Type === "Static") {
					return
				}

				// Go through and grab our start/end times
				const vocalTimes: {
					StartTime: number;
					EndTime: number;
				}[] = []
				if (lyrics.Type === "Line") {
					for(const vocal of lyrics.Content) {
						if (vocal.Type === "Vocal") {
							vocalTimes.push(
								{
									StartTime: vocal.StartTime,
									EndTime: vocal.EndTime
								}
							)
						}
					}
				} else if (lyrics.Type === "Syllable") {
					for(const vocal of lyrics.Content) {
						if (vocal.Type === "Vocal") {
							let startTime = vocal.Lead.StartTime, endTime = vocal.Lead.EndTime
							if (vocal.Background !== undefined) {
								for(const backgroundVocal of vocal.Background) {
									startTime = Math.min(startTime, backgroundVocal.StartTime)
									endTime = Math.max(endTime, backgroundVocal.EndTime)
								}
							}
							vocalTimes.push(
								{
									StartTime: startTime,
									EndTime: endTime
								}
							)
						}
					}
				}

				// First check if our first vocal-group needs an interlude before it
				let addedStartInterlude = false
				{
					const firstVocalGroup = vocalTimes[0]

					if (firstVocalGroup.StartTime >= MinimumInterludeDuration) {
						vocalTimes.unshift({StartTime: -1, EndTime: -1})
						lyrics.Content.unshift(
							{
								Type: "Interlude",

								StartTime: 0,
								EndTime: (firstVocalGroup.StartTime - EndInterludeEarlyBy)
							}
						)

						addedStartInterlude = true
					}
				}

				// Now go through our vocals and determine if we need to add an interlude anywhere
				for (
					let index = (vocalTimes.length - 1);
					index > (addedStartInterlude ? 1 : 0);
					index -= 1
				) {
					const endingVocalGroup = vocalTimes[index]
					const startingVocalGroup = vocalTimes[index - 1]

					if ((endingVocalGroup.StartTime - startingVocalGroup.EndTime) >= MinimumInterludeDuration) {
						vocalTimes.splice(index, 0, {StartTime: -1, EndTime: -1})
						lyrics.Content.splice(
							index,
							0,
							{
								Type: "Interlude",

								StartTime: startingVocalGroup.EndTime,
								EndTime: (endingVocalGroup.StartTime - EndInterludeEarlyBy)
							}
						)
					}
				}
			}
		)

		// Finally, return our lyrics
		.then(() => lyrics)
	)
}