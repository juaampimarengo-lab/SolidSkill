import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { MediaFormat } from '../persistence'

const MAX_BYTES = 15 * 1024 * 1024 // 15 MB — a generous chart screenshot ceiling, not a product limit.

const EXTENSION: Record<MediaFormat, string> = { PNG: '.png', JPEG: '.jpg', WEBP: '.webp' }
export const MEDIA_CONTENT_TYPE: Record<MediaFormat, string> = {
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  WEBP: 'image/webp'
}

/**
 * Detects the real image format from its magic bytes. Never trusts a file
 * extension or a client-supplied MIME type — only the bytes decide. Returns
 * null for anything else, including formats Solid Skill deliberately does
 * not accept (SVG, GIF, BMP, executables, HTML masquerading as an image).
 */
export function detectImageFormat(buffer: Buffer): MediaFormat | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'PNG'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'JPEG'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'WEBP'
  }
  return null
}

export function validateImageBuffer(buffer: Buffer): MediaFormat {
  if (buffer.length === 0) throw new Error('The image file is empty.')
  if (buffer.length > MAX_BYTES) throw new Error('The image file is too large (max 15 MB).')
  const format = detectImageFormat(buffer)
  if (format === null) throw new Error('Unsupported or unrecognized image format. Use PNG, JPEG, or WebP.')
  return format
}

/**
 * Owns the userData/media/ tree. Every managed path is generated here from an
 * opaque media id — never from a caption, instrument, or any other user
 * input — and every delete is re-verified to stay inside the media root
 * before touching disk, so a corrupted or malformed database row can never
 * be used to delete an arbitrary file.
 */
export class MediaStorage {
  private readonly root: string

  constructor(mediaRoot: string) {
    this.root = resolve(mediaRoot)
  }

  /** Writes validated bytes under trades/<tradeId>/ and returns the path relative to the media root. */
  writeTradeImage(tradeId: string, mediaId: string, format: MediaFormat, bytes: Buffer): string {
    const relativeDir = join('trades', tradeId)
    return this.write(relativeDir, mediaId, format, bytes)
  }

  /** Writes validated bytes under days/<accountId>/<date>/ and returns the path relative to the media root. */
  writeDayImage(accountId: string, date: string, mediaId: string, format: MediaFormat, bytes: Buffer): string {
    const relativeDir = join('days', accountId, date)
    return this.write(relativeDir, mediaId, format, bytes)
  }

  /** Absolute path for a stored relative path, or null if it would escape the media root (path traversal). */
  resolveManaged(relativePath: string): string | null {
    const absolute = resolve(this.root, relativePath)
    if (absolute !== this.root && !absolute.startsWith(this.root + sep)) return null
    return absolute
  }

  read(relativePath: string): Buffer | null {
    const absolute = this.resolveManaged(relativePath)
    if (absolute === null) return null
    try {
      return readFileSync(absolute)
    } catch {
      return null
    }
  }

  /** Deletes the managed file if present. Never throws on a missing file — deletion must still remove the DB row. */
  deleteIfManaged(relativePath: string): void {
    const absolute = this.resolveManaged(relativePath)
    if (absolute === null) return
    try {
      unlinkSync(absolute)
    } catch {
      // Missing file / already gone is not an error here (docs/TRADE_MEDIA.md, deletion consistency).
    }
  }

  private write(relativeDir: string, mediaId: string, format: MediaFormat, bytes: Buffer): string {
    const absoluteDir = resolve(this.root, relativeDir)
    if (absoluteDir !== this.root && !absoluteDir.startsWith(this.root + sep)) {
      throw new Error('Refusing to write outside the managed media root.')
    }
    mkdirSync(absoluteDir, { recursive: true })
    const relativePath = join(relativeDir, `${mediaId}${EXTENSION[format]}`)
    writeFileSync(resolve(this.root, relativePath), bytes)
    return relativePath
  }
}
