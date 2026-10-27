// The following image is a visual representation of the stages in a single frame
// https://miro.medium.com/v2/resize:fit:1400/format:webp/1*ad-k5hYKQnRQJF8tv8BIqg.png

// Define a simple and easy data format for keeping track of scheduled tasks
type Scheduled = [(0 | 1 | 2), number, true?] // First defines which type of task was scheduled, second is its id

// Some tasks are backed by more than a single timer (see Defer), so we keep any
// extra handles here rather than widening the Scheduled tuple that Maid inspects.
const ExtraHandles = new WeakMap<Scheduled, () => void>()

export const Cancel = (scheduled: Scheduled) => {
	if (scheduled[2]) {
		return // Prevents any logic processing on a cancelled task
	}

	scheduled[2] = true

	ExtraHandles.get(scheduled)?.()
	ExtraHandles.delete(scheduled)

	switch (scheduled[0]) {
		case 0: globalThis.clearTimeout(scheduled[1]); break;
		case 1: globalThis.clearInterval(scheduled[1]); break;
		case 2: globalThis.cancelAnimationFrame(scheduled[1]); break;
	}
}

// QOL Type
// deno-lint-ignore no-explicit-any
type ScheduledCallback = (...args: any[]) => void

// Handle Javascript Timer Scheduling
export const Timeout = (seconds: number, callback: ScheduledCallback): Scheduled => {
	return [0, setTimeout(callback, (seconds * 1000)) as unknown as number]
}
export const Interval = (everySeconds: number, callback: ScheduledCallback): Scheduled => {
	return [1, setInterval(callback, (everySeconds * 1000)) as unknown as number]
}

// Now handle Browser Event Scheduling
export const OnPreRender = (callback: ScheduledCallback): Scheduled => {
	return [2, requestAnimationFrame(callback)]
}
export const Defer = (callback: ScheduledCallback): Scheduled => {
	const scheduled: Scheduled = [2, 0]
	let hasRun = false
	let fallbackTimeout = 0

	const Run = () => {
		// Whichever handle wins the race runs the callback, the loser is a no-op
		if (hasRun) {
			return
		}
		hasRun = true

		globalThis.clearTimeout(fallbackTimeout)
		ExtraHandles.delete(scheduled)

		callback()
	}

	// Browsers stop delivering animation frames entirely while the window is
	// hidden, occluded or minimised. Spotify regularly boots (and Spicetify
	// loads us) while it is still in that state, which would strand anything
	// polling on a frame forever. Racing a frame against a macrotask guarantees
	// the callback still runs once the window is restored.
	scheduled[1] = requestAnimationFrame(Run)
	fallbackTimeout = globalThis.setTimeout(Run, 0) as unknown as number
	ExtraHandles.set(scheduled, () => globalThis.clearTimeout(fallbackTimeout))

	return scheduled
}

export type { Scheduled }
export const IsScheduled = (value: unknown): value is Scheduled => {
	return (
		Array.isArray(value)
		&& ((value.length === 2) || (value.length === 3))
		&& (typeof value[0] === 'number')
		&& (typeof value[1] === 'number')
		&& ((value[2] === undefined) || (value[2] === true))
	)
}