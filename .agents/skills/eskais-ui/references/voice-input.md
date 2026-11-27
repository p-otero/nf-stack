# Voice input

Part of the `eskais-ui` skill.

`VoiceInput` shows that a person is heard: its visual follows the microphone level in real time. It doesn't record or transcribe. You own the microphone and the words; it owns the toggle, the keys, the announcements and the level.

```tsx
import { VoiceInput, type VoiceInputState } from "@/components/ui/voice-input"
import { requestMicrophone, stopStream } from "@/lib/microphone"

function Dictation({ onText }: { onText: (text: string) => void }) {
  const [state, setState] = useState<VoiceInputState>("idle")
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [startedAt, setStartedAt] = useState<number>()

  async function start() {
    setState("requesting")
    const result = await requestMicrophone()
    if (result.state !== "listening") return setState(result.state) // "denied" or "error"
    setStream(result.stream)
    setStartedAt(Date.now())
    setState("listening")
    // start your recorder or speech recognition on result.stream here
  }

  return (
    <VoiceInput
      variant="bar"
      state={state}
      stream={stream}
      startedAt={startedAt}
      onStart={() => void start()}
      onConfirm={async () => {
        stopStream(stream)
        setStream(null)
        setState("processing")
        onText(await transcribe())
        setState("idle")
      }}
      onCancel={() => {
        stopStream(stream)
        setStream(null)
        setState("idle")
      }}
    />
  )
}
```

- **States**: `idle`, `requesting` (waiting for the permission prompt), `listening`, `processing`, `error`, `denied`. It never changes `state` itself while you pass it: the callbacks ask. `onStateChange(next, details)` gets the same requests in one place (`requesting` to start, `processing` to keep, `idle` to discard).
- **Variants**: `button` (default) is a Dictate toggle, pressed while listening, with a ring that grows with the level; put it beside a composer's text field. `bar` is cancel, a waveform of `bars` (24) recent levels and a timer (`startedAt`, rendering once a second, or `elapsed` in seconds), with the toggle at the end showing a check while listening.
- **Keys**: Enter or Space on the toggle starts, and finishes while listening; Escape cancels while requesting or listening (and leaves Escape to a dialog otherwise); the cancel button hands focus back to the toggle.
- **Announcements**: each state is read politely from `labels` (`listening`, `processing`, `denied`…), which also translate the names (`group`, `toggle`, `cancel`, `timer`). Two voice inputs on one page need different `labels.group` and `labels.toggle`, so agents and people can tell them apart.
- **Errors**: `requestMicrophone(constraints?)` maps NotAllowedError and SecurityError to `denied`, NotFoundError, OverconstrainedError and NotReadableError to `error` (with `error: "not-found" | "not-readable" | "insecure-context" | "unsupported"`). `error` and `denied` show the label in the destructive tone (`voiceInputTone(state)`), and the toggle tries again. Ask only from a press, never on page load.
- **Agents**: `start`, `confirm` and `cancel` by the group's label. `details.source === "agent"` in `onStart` tells you an agent asked to open the microphone; decide whether to allow it.

## The level

The level is RMS → dBFS → 0–1 (linear in decibels from `floorDb` -60 to `ceilingDb` -12), smoothed with an `attack` (30 ms) and a `release` (250 ms), on animation frames, from an `AnalyserNode` on one shared AudioContext. It is written as custom properties on the root, never as React state: `--voice-level`, and `--voice-bar-0`… for the bar. Tune it with `level={{ floorDb, ceilingDb, attack, release, barInterval }}`.

- Sampling stops and the AudioContext closes when `state` leaves `listening`, the stream's audio ends, the page is hidden or the component unmounts.
- Under `prefers-reduced-motion: reduce` the level takes four steps and the bars hold a still hump instead of scrolling.
- The AudioContext is created or resumed in the press that starts (Safari needs that), and a suspended one resumes on the next press or key.

For a visual of your own, `useAudioLevel(stream, { active, bars, onFrame })` from `use-audio-level` returns `{ ref, level }`: put `ref` on an element and style it with `var(--voice-level)`, draw on a canvas in `onFrame({ level, bars })`, or read `level()`. `createAudioMeter(stream, options)` from `@/lib/audio-meter` is the same without React.

## Electron

Chromium's `getUserMedia` and Web Audio work as in Chrome. Allow the permission in the main process, `session.defaultSession.setPermissionRequestHandler((_, permission, callback, details) => callback(permission === "media" && details.mediaTypes?.includes("audio") === true))`, and on macOS ask with `systemPreferences.askForMediaAccess("microphone")` and set `NSMicrophoneUsageDescription` in the app's Info.plist. Without them `requestMicrophone()` reports `denied`.
