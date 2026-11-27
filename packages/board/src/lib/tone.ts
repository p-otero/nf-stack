const tones = ["neutral", "info", "success", "warning", "destructive", "violet"] as const

type Tone = (typeof tones)[number]

/** The same tones by name, for code that avoids loose string literals: `tone={Tone.success}`. */
const Tone = {
  neutral: "neutral",
  info: "info",
  success: "success",
  warning: "warning",
  destructive: "destructive",
  violet: "violet",
} as const satisfies { [name in Tone]: name }

export { Tone, tones }
