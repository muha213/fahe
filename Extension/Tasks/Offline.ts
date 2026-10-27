import Bundle from "@Spices/Build/Bundle.ts"
const code = await Bundle({ Type: "Offline" })
await Deno.writeTextFile("./Builds/Offline/beautiful-lyrics.mjs", code as string)
await Deno.writeTextFile("./Builds/Release/beautiful-lyrics.mjs", code as string)
console.log("Bundles written to Builds/Offline and Builds/Release")
