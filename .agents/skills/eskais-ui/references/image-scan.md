# Image scan

`ImageScan` (the `image-scan` item) shows an image while something analyses it, then what it found. It renders no model and runs no timers: you drive `status` from your analysis's events.

## States

| `status`   | Shows                                                                                                  | Handler that adds a button |
| ---------- | ------------------------------------------------------------------------------------------------------ | -------------------------- |
| `uploaded` | the preview                                                                                            | `onScan` (Scan image)      |
| `scanning` | a turning sweep, or with `progress` (0 to 1) a line at that fraction; a progress bar, optional `steps` | `onCancel` (Cancel scan)   |
| `result`   | `regions` as toggle buttons over the image, a legend under it and "3 items found"                      | none                       |
| `error`    | the image greyed, `error` (or `labels.error`) in the destructive tone                                  | `onRetry` (Retry scan)     |

Leave `progress` out while the analysis can't tell how far it is; pass it once it can. `statusText` is the bar's label ("Finding objects"); `steps={[{ id, label }]}` with `step` (the running one's id) lists the stages, the earlier ones ticked. `actions` adds your own buttons beside the state's (a "Choose another" button).

## Regions

`regions={[{ id, label, box: { x, y, width, height }, description?, tone? }]}`: the box is in fractions of the image, from its top left corner, as most detectors return it (divide pixel boxes by the image's natural size). It is physical: right to left doesn't mirror an image, so it doesn't mirror the boxes. They render in reading order (top to bottom, then left to right). `description` follows the label ("92%"); `tone` colours the box and its legend swatch.

`selectedRegion` / `defaultSelectedRegion` / `onSelectedRegionChange(id | null, details)` hold the selection; a second press clears it, and `details.cancel()` refuses it.

## Frame and fit

By default the frame takes the image's ratio, so nothing is cropped or letterboxed. Pass `width` and `height` (the image's pixels) so the frame has its height before the image loads. `aspectRatio` gives the frame its own ratio, and `fit` (`contain` or `cover`) says how the image fills it; the boxes follow in CSS, from the frame's container units, with no measuring. `mapRegionBox(box, { fit, image, frame })` returns the same rectangle in the frame's pixels, for a canvas or a test.

## Pick, crop, scan

Compose it with `FileUpload` and `ImageCropper`; neither is a dependency of `image-scan`:

```tsx
const [file, setFile] = useState<File>()
const [crop, setCrop] = useState<Required<ImageCrop>>()
const [scan, setScan] = useState<{ src: string; width: number; height: number }>()

// 1. Pick: <FileUpload accept={["image/*"]} onValueChange={(files) => setFile(files[0])} … /> in a Field.
// 2. Crop: <ImageCropper src={url} alt="…" onCropChange={setCrop} />, then on a button press:
const cropped = await cropImage(url, crop, { width: Math.min(crop.width, 1024) })
setScan({ src: URL.createObjectURL(cropped), width: crop.width, height: crop.height })
// 3. Scan: <ImageScan src={scan.src} alt="…" width={scan.width} height={scan.height} status={status}
//    progress={progress} regions={regions} onScan={start} onCancel={stop} onRetry={start} />
```

Run the analysis from `onScan` (a worker, WebGPU, a request), report `progress` as it arrives, and set `status="result"` with the regions, or `"error"` with `error`. `onCancel` stops your work; the component only reports the press.

## Accessibility and agents

- `alt` is required and names the group, which is `aria-busy` while scanning.
- Screen readers hear `labels.scanning` (or `statusText`), progress at most every tenth and two seconds (`labels.progress(percent)`), `labels.found(count)`, and the error at once (assertive). Every word is in `labels`.
- Each region is a button with `aria-pressed`, named by its label and description; the legend is pointer only (`aria-hidden`), a larger target on touch.
- Agents see the image by its alt, the regions as its items, and call `scan`, `cancel`, `retry` and `selectRegion(id or label)`. Outside its state an action throws (and a programmatic call too), so the agent's step fails with the reason instead of reporting success.

## Motion

The sweep is one rotation and the progress line a translate, both on the compositor; regions fade in with a short stagger. Under reduced motion the sweep and the brackets' pulse stop and the stagger collapses: a still frame and the progress bar remain.
