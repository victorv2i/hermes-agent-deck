/**
 * Composer image attachments — turn a picked / pasted / dropped File into a
 * {@link RunAttachment} the run carries inline.
 *
 * Stock hermes routes vision NATIVELY: the gateway `/v1/runs` accepts a
 * multimodal `input` whose content parts may be inline `image_url`
 * (`data:image/...;base64,...`) — there is NO upload endpoint. So an attachment
 * is just the image encoded as a base64 data URL, carried on the run command;
 * the BFF folds it into the gateway's multimodal shape (see gatewayClient).
 *
 * IMAGE ONLY by design: the gateway rejects file/document parts, so we accept
 * only `image/*` files and never pretend to carry arbitrary documents.
 *
 * LOCAL-ONLY: the image is read in-browser and travels on the same loopback run
 * path as the text — it never hits a third party.
 */
import type { RunAttachment } from '@agent-deck/protocol'

/** A pending composer attachment: the protocol payload plus a stable client id
 * (for the removable preview pill's key + remove action). */
export interface PendingAttachment extends RunAttachment {
  /** Client-only id for list keys / removal — never sent to the gateway. */
  id: string
}

/** Cap the inline image size. The gateway carries the base64 data URL in the run
 * body; a very large image bloats the request and the context. 10 MB (pre-base64)
 * is a generous ceiling for a screenshot while guarding against a pathological
 * drop. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** True for a File the composer will accept as an image attachment. */
export function isAcceptedImage(file: File): boolean {
  return file.type.startsWith('image/')
}

/** Why a File was rejected, for an honest user-facing message. */
export type AttachmentReject = 'not-image' | 'too-large' | 'read-failed'

export interface AttachmentResult {
  attachment?: PendingAttachment
  reject?: AttachmentReject
}

let idCounter = 0
/** Monotonic client id for a pending attachment (list key + removal). */
function nextId(): string {
  idCounter += 1
  return `att_${idCounter}_${Date.now()}`
}

/**
 * Read a File into a {@link PendingAttachment}. Rejects non-images and oversize
 * files HONESTLY (the caller surfaces the reason); a read error is caught rather
 * than thrown. The data URL is produced by FileReader, so it is exactly the
 * `data:image/<mime>;base64,<...>` shape the gateway accepts.
 */
export async function fileToAttachment(file: File): Promise<AttachmentResult> {
  if (!isAcceptedImage(file)) return { reject: 'not-image' }
  if (file.size > MAX_IMAGE_BYTES) return { reject: 'too-large' }
  const dataUrl = await readAsDataUrl(file)
  if (dataUrl === null || !dataUrl.startsWith('data:image/')) return { reject: 'read-failed' }
  return {
    attachment: {
      id: nextId(),
      kind: 'image',
      name: file.name || 'image',
      mime: file.type,
      data_url: dataUrl,
    },
  }
}

/** Promisified FileReader.readAsDataURL; resolves null on any read error. */
function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    } catch {
      resolve(null)
    }
  })
}

/** Extract image Files from a clipboard paste (⌘V of a screenshot). Returns only
 * the `image/*` items, in order. */
export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) out.push(file)
    }
  }
  return out
}

/** Extract image Files from a drag-drop. Mirrors {@link imageFilesFromClipboard}
 * but reads `files` (a drop carries Files directly). */
export function imageFilesFromDrop(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files).filter((f) => f.type.startsWith('image/'))
}

/** Strip the client-only `id` so a {@link PendingAttachment} becomes the wire
 * {@link RunAttachment} the run command carries. */
export function toRunAttachment(p: PendingAttachment): RunAttachment {
  return { kind: p.kind, name: p.name, mime: p.mime, data_url: p.data_url }
}
