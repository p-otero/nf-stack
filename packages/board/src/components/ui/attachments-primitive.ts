import { definePrimitive, dispatch, type ChangeDetails, type ChangeOptions } from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"

type Attachment = {
  id: string
  name: string
  kind: "image" | "file"
  src: string
  srcDark?: string
  thumbnail?: string
  thumbnailDark?: string
  alt: string
  href?: string
  /** Bytes. */
  size?: number
  mimeType?: string
}

type AttachmentOpenReason = "item-press" | "imperative"

type AttachmentsOptions = {
  attachments?: readonly Attachment[]
  /** Runs before an attachment opens; `details.cancel()` keeps it closed. */
  onOpen?: (attachment: Attachment, details: ChangeDetails<AttachmentOpenReason>) => void
  /** What opening does once `onOpen` allowed it: the component shows an image or follows a file's link. */
  open?: (attachment: Attachment, event: Event | undefined) => void
}

function reasonOf(options: unknown): { reason: AttachmentOpenReason; event?: Event } {
  if (typeof options !== "object" || options === null) return { reason: "imperative" }
  const { reason = "imperative", event } = options as ChangeOptions<AttachmentOpenReason>
  return { reason, event: event instanceof Event ? event : undefined }
}

const attachments = definePrimitive({
  name: "attachments",
  options: { attachments: "value", onOpen: "callback", open: "value" },
  state: (options: AttachmentsOptions) => ({ count: options.attachments?.length ?? 0 }),
  sync: (options) => ({ count: options.attachments?.length ?? 0 }),
  api: (context) => {
    const list = () => context.options().attachments ?? []
    return {
      // The agent bridge passes arguments unchecked.
      openAttachment(id: unknown, options?: ChangeOptions<AttachmentOpenReason>) {
        const attachment = list().find((candidate) => candidate.id === id)
        if (!attachment) {
          const ids = list().map((candidate) => candidate.id)
          throw new RangeError(`No attachment "${String(id)}". Attachments: ${ids.join(", ")}.`)
        }
        const details = reasonOf(options)
        if (dispatch(context, "onOpen", attachment, details)) return settled(false, "openAttachment", details)
        context.options().open?.(attachment, details.event)
        return true
      },
      entries: () => list().map((attachment) => ({ value: attachment.id, label: attachment.name })),
    }
  },
  slots: (slot) => ({
    root: slot({ role: "group", attrs: (state) => ({ "data-count": String(state.count) }) }),
  }),
  agent: { actions: ["openAttachment"], items: (api) => api.entries() },
})

export { attachments }
export type { Attachment, AttachmentOpenReason, AttachmentsOptions }
