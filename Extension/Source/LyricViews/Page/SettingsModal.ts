import { Spotify } from "@Spices/Spicetify/Services/Session.ts"
import {
	GetUseFallbackProviders, ToggleUseFallbackProviders, UseFallbackProvidersChanged,
	GetSelectedProvider, SetSelectedProvider, SelectedProviderChanged,
	ProviderOptions, ProviderLabels, type ProviderOption,
	GetFontFamily, SetFontFamily,
	GetFPS, SetFPS,
	GetFullscreenDarkness, SetFullscreenDarkness,
	GetRomanizationSeparator, SetRomanizationSeparator,
	GetFontSize, SetFontSize,
} from "../Shared.ts"
import Icons from "./Icons.ts"

const sharedSelectStyles: Partial<CSSStyleDeclaration> = {
	background: "#333",
	color: "#fff",
	border: "none",
	borderRadius: "4px",
	padding: "6px 8px",
	fontSize: "13px",
	fontFamily: "inherit",
	cursor: "pointer",
	outline: "none",
	flex: "1",
}

const createRow = () => {
	const row = document.createElement("div")
	row.style.display = "flex"
	row.style.alignItems = "center"
	row.style.gap = "12px"
	return row
}

const createLabel = (text: string) => {
	const label = document.createElement("span")
	label.textContent = text
	label.style.fontSize = "14px"
	label.style.fontWeight = "500"
	label.style.flexShrink = "0"
	return label
}

const createToggle = (initial: boolean, onChange: (v: boolean) => void) => {
	const toggle = document.createElement("button")
	toggle.style.width = "36px"
	toggle.style.height = "20px"
	toggle.style.borderRadius = "10px"
	toggle.style.border = "none"
	toggle.style.cursor = "pointer"
	toggle.style.position = "relative"
	toggle.style.transition = "background-color 0.2s"
	toggle.style.flexShrink = "0"
	toggle.setAttribute("role", "switch")

	const knob = document.createElement("div")
	knob.style.width = "16px"
	knob.style.height = "16px"
	knob.style.borderRadius = "50%"
	knob.style.background = "#fff"
	knob.style.position = "absolute"
	knob.style.top = "2px"
	knob.style.transition = "left 0.2s"
	knob.style.boxShadow = "0 1px 3px rgba(0,0,0,0.3)"
	toggle.appendChild(knob)

	const update = (enabled: boolean) => {
		toggle.style.background = enabled ? "#1ed760" : "#535353"
		knob.style.left = enabled ? "18px" : "2px"
	}
	update(initial)
	toggle.addEventListener("click", () => {
		const next = !((toggle.style.background === "#1ed760") ? true : false)
		update(next)
		onChange(next)
	})
	return toggle
}

// Detect system fonts (common ones)
const COMMON_FONTS = [
	"",
	"System Default",
	"Arial",
	"Verdana",
	"Tahoma",
	"Trebuchet MS",
	"Times New Roman",
	"Georgia",
	"Garamond",
	"Courier New",
	"Brush Script MT",
	"Segoe UI",
	"Helvetica Neue",
	"SF Pro",
]

export const ShowSettingsModal = (): void => {
	const content = document.createElement("div")
	content.style.padding = "16px"
	content.style.display = "flex"
	content.style.flexDirection = "column"
	content.style.gap = "16px"
	content.style.maxHeight = "70vh"
	content.style.overflowY = "auto"

	// --- Provider ---
	{
		const row = createRow()
		const label = createLabel("Provider")
		const select = document.createElement("select")
		Object.assign(select.style, sharedSelectStyles)

		for (const option of ProviderOptions) {
			const optEl = document.createElement("option")
			optEl.value = option
			optEl.textContent = ProviderLabels[option]
			select.appendChild(optEl)
		}
		select.value = GetSelectedProvider()

		select.addEventListener("change", () => SetSelectedProvider(select.value as ProviderOption))
		SelectedProviderChanged.Connect((provider) => { select.value = provider })

		row.appendChild(label)
		row.appendChild(select)
		content.appendChild(row)
	}

	// --- Fallback Toggle ---
	{
		const row = createRow()
		const label = createLabel("Use Fallback Providers")
		label.style.flex = "1"
		const toggle = createToggle(GetUseFallbackProviders(), ToggleUseFallbackProviders)
		UseFallbackProvidersChanged.Connect((v) => {
			toggle.style.background = v ? "#1ed760" : "#535353"
			toggle.firstElementChild && ((toggle.firstElementChild as HTMLElement).style.left = v ? "18px" : "2px")
		})
		row.appendChild(label)
		row.appendChild(toggle)
		content.appendChild(row)
	}

	// --- Divider ---
	const divider = () => {
		const d = document.createElement("hr")
		d.style.border = "none"
		d.style.borderTop = "1px solid #444"
		d.style.margin = "4px 0"
		return d
	}
	content.appendChild(divider())

	// --- Font Selector ---
	{
		const row = createRow()
		const label = createLabel("Font")
		const select = document.createElement("select")
		Object.assign(select.style, sharedSelectStyles)

		const currentFont = GetFontFamily()
		for (const font of COMMON_FONTS) {
			const opt = document.createElement("option")
			opt.value = font
			opt.textContent = font || "Default"
			if (font) opt.style.fontFamily = font
			select.appendChild(opt)
		}
		select.value = currentFont

		select.addEventListener("change", () => SetFontFamily(select.value))
		row.appendChild(label)
		row.appendChild(select)
		content.appendChild(row)
	}

	// --- FPS Slider ---
	{
		const row = createRow()
		row.style.flexWrap = "wrap"
		const label = createLabel("FPS")
		label.style.flex = "1"

		const value = document.createElement("span")
		value.style.fontSize = "13px"
		value.style.color = "#999"

		const slider = document.createElement("input")
		slider.type = "range"
		slider.min = "15"
		slider.max = "120"
		slider.step = "5"
		slider.style.flex = "0 0 100%"
		slider.style.marginTop = "4px"

		const updateSlider = (v: number) => {
			slider.value = String(v)
			value.textContent = `${v} FPS`
		}
		updateSlider(GetFPS())

		slider.addEventListener("input", () => {
			const v = Number(slider.value)
			SetFPS(v)
			value.textContent = `${v} FPS`
		})

		row.appendChild(label)
		row.appendChild(value)
		row.appendChild(slider)
		content.appendChild(row)
	}

	// --- Fullscreen Darkness ---
	{
		const row = createRow()
		row.style.flexWrap = "wrap"
		const label = createLabel("Fullscreen BG Darkness")
		label.style.flex = "1"

		const value = document.createElement("span")
		value.style.fontSize = "13px"
		value.style.color = "#999"

		const slider = document.createElement("input")
		slider.type = "range"
		slider.min = "0"
		slider.max = "100"
		slider.step = "5"
		slider.style.flex = "0 0 100%"
		slider.style.marginTop = "4px"

		const updateSlider = (v: number) => {
			slider.value = String(v)
			value.textContent = `${v}%`
		}
		updateSlider(GetFullscreenDarkness())

		slider.addEventListener("input", () => {
			const v = Number(slider.value)
			SetFullscreenDarkness(v)
			value.textContent = `${v}%`
		})

		row.appendChild(label)
		row.appendChild(value)
		row.appendChild(slider)
		content.appendChild(row)
	}

	// --- Divider ---
	content.appendChild(divider())

	// --- Romanization Separator ---
	{
		const row = createRow()
		const label = createLabel("Romanization Separator")
		const select = document.createElement("select")
		Object.assign(select.style, sharedSelectStyles)

		const options: { value: string; label: string }[] = [
			{ value: "", label: "Space (default)" },
			{ value: "-", label: "Hyphen (-)" },
			{ value: ".", label: "Dot (.)" },
		]
		for (const opt of options) {
			const el = document.createElement("option")
			el.value = opt.value
			el.textContent = opt.label
			select.appendChild(el)
		}
		select.value = GetRomanizationSeparator()
		select.addEventListener("change", () => SetRomanizationSeparator(select.value))

		row.appendChild(label)
		row.appendChild(select)
		content.appendChild(row)
	}

	// --- Font Size Slider ---
	{
		const row = createRow()
		row.style.flexWrap = "wrap"
		const label = createLabel("Font Size")
		label.style.flex = "1"

		const value = document.createElement("span")
		value.style.fontSize = "13px"
		value.style.color = "#999"

		const slider = document.createElement("input")
		slider.type = "range"
		slider.min = "0"
		slider.max = "48"
		slider.step = "1"
		slider.style.flex = "0 0 100%"
		slider.style.marginTop = "4px"

		const updateSlider = (v: number) => {
			slider.value = String(v)
			value.textContent = v ? `${v}px` : "Default"
		}
		updateSlider(GetFontSize())

		slider.addEventListener("input", () => {
			const v = Number(slider.value)
			SetFontSize(v)
			value.textContent = v ? `${v}px` : "Default"
		})

		row.appendChild(label)
		row.appendChild(value)
		row.appendChild(slider)
		content.appendChild(row)
	}

	Spotify.PopupModal.display({
		title: "Beautiful Lyrics Settings",
		content,
		isLarge: false,
	})
}
