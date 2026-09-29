import Bundle from "@Spices/Build/Bundle.ts"
const code = await Bundle({ Type: "Offline" })
await Deno.writeTextFile("./Builds/Offline/beautiful-lyrics.mjs", code as string)
console.log("Offline bundle written to Builds/Offline/beautiful-lyrics.mjs")
