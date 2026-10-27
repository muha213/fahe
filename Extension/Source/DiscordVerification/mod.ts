// Spices
import {
	GlobalMaid,
	OnSpotifyReady
} from "@Spices/Spicetify/Services/Session.ts"

// Module - Discord verification endpoint is offline, keeping as no-op
OnSpotifyReady.then(() => {})