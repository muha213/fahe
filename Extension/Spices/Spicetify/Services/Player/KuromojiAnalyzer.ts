// Type Imports
import type KuromojiType from "npm:@types/kuromoji@^0.1.3"
import type { Tokenizer, IpadicFeatures } from "npm:@types/kuromoji@^0.1.3"

// Language Module - Kuromoji.js is a UMD bundle that exports to global.kuromoji
import "./Kuromoji.js"
// deno-lint-ignore no-explicit-any
const Kuromoji = (globalThis as any).kuromoji as typeof KuromojiType

// CORS proxy for kuromoji dictionaries (GitHub raw serves with CORS)
const KUROMOJI_DICT_BASE = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/"

// Export our Kuromoji Analyzer (required format so we can be passed into Kuroshiro)
let Analyzer: (Tokenizer<IpadicFeatures> | undefined)
export const init = (): Promise<void> => {
	if (Analyzer !== undefined) {
		return Promise.resolve()
	}

	return new Promise(
		(resolve, reject) => {
			Kuromoji.builder(
				{
					dicPath: KUROMOJI_DICT_BASE
				}
			).build(
				(error, analyzer) => {
					if (error) {
						return reject(error)
					}

					Analyzer = analyzer
					resolve()
				}
			)
		}
	)
}
export const parse = (text = ""): Promise<IpadicFeatures[]> => {
	if ((text.trim() === "") || (Analyzer === undefined)) {
		return Promise.resolve([])
	}

	// deno-lint-ignore no-explicit-any
	const result = Analyzer.tokenize(text) as any[]
	for(const token of result) {
		token.verbose = {
			word_id: token.word_id,
			word_type: token.word_type,
			word_position: token.word_position
		}
		delete token.word_id
		delete token.word_type
		delete token.word_position
	}

	return Promise.resolve(result)
}