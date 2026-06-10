import { describe, it, expect } from 'vitest'
import {
  fileToAttachment,
  isAcceptedImage,
  imageFilesFromClipboard,
  imageFilesFromDrop,
  toRunAttachment,
  MAX_IMAGE_BYTES,
  type PendingAttachment,
} from './imageAttachments'

/** A tiny valid PNG-typed File (content is irrelevant to FileReader's data-URL). */
function pngFile(name = 'shot.png', bytes = 4): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

/**
 * jsdom does not implement DataTransfer, so build a structural stand-in carrying
 * just the surface our helpers read: `items` (clipboard) and `files` (drop).
 * Each item mirrors a DataTransferItem (`kind`, `type`, `getAsFile`).
 */
function fakeDataTransfer(files: File[]): DataTransfer {
  const items = files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f }))
  return {
    items: items as unknown as DataTransferItemList,
    files: files as unknown as FileList,
  } as DataTransfer
}

describe('isAcceptedImage', () => {
  it('accepts image/* and rejects everything else', () => {
    expect(isAcceptedImage(pngFile())).toBe(true)
    expect(isAcceptedImage(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe(false)
    expect(isAcceptedImage(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(false)
  })
})

describe('fileToAttachment', () => {
  it('reads an image into a data:image/... attachment', async () => {
    const { attachment, reject } = await fileToAttachment(pngFile('cat.png'))
    expect(reject).toBeUndefined()
    expect(attachment).toBeDefined()
    expect(attachment!.kind).toBe('image')
    expect(attachment!.name).toBe('cat.png')
    expect(attachment!.mime).toBe('image/png')
    expect(attachment!.data_url.startsWith('data:image/png')).toBe(true)
    expect(attachment!.id).toBeTruthy()
  })

  it('rejects a non-image file honestly', async () => {
    const res = await fileToAttachment(new File(['x'], 'doc.pdf', { type: 'application/pdf' }))
    expect(res.attachment).toBeUndefined()
    expect(res.reject).toBe('not-image')
  })

  it('rejects an oversize image', async () => {
    // Construct a File reporting a size over the cap without allocating it.
    const big = pngFile('huge.png', 1)
    Object.defineProperty(big, 'size', { value: MAX_IMAGE_BYTES + 1 })
    const res = await fileToAttachment(big)
    expect(res.attachment).toBeUndefined()
    expect(res.reject).toBe('too-large')
  })
})

describe('imageFilesFromClipboard', () => {
  it('returns only image items from a clipboard DataTransfer', () => {
    const dt = fakeDataTransfer([
      pngFile('paste.png'),
      new File(['hello'], 'note.txt', { type: 'text/plain' }),
    ])
    const files = imageFilesFromClipboard(dt)
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe('paste.png')
  })

  it('returns [] for null data', () => {
    expect(imageFilesFromClipboard(null)).toEqual([])
  })
})

describe('imageFilesFromDrop', () => {
  it('returns only image files from a drop DataTransfer', () => {
    const dt = fakeDataTransfer([
      pngFile('drop.png'),
      new File(['x'], 'a.json', { type: 'application/json' }),
    ])
    const files = imageFilesFromDrop(dt)
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe('drop.png')
  })

  it('returns [] for null data', () => {
    expect(imageFilesFromDrop(null)).toEqual([])
  })
})

describe('toRunAttachment', () => {
  it('strips the client-only id', () => {
    const pending: PendingAttachment = {
      id: 'att_1',
      kind: 'image',
      name: 'x.png',
      mime: 'image/png',
      data_url: 'data:image/png;base64,AAAA',
    }
    const wire = toRunAttachment(pending)
    expect(wire).toEqual({
      kind: 'image',
      name: 'x.png',
      mime: 'image/png',
      data_url: 'data:image/png;base64,AAAA',
    })
    expect('id' in wire).toBe(false)
  })
})
