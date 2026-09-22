import { protocol } from 'electron'
import type { Database } from '../persistence'
import { MEDIA_CONTENT_TYPE, type MediaStorage } from './mediaStorage'

export const MEDIA_PROTOCOL = 'ssmedia'

/**
 * Must run before app.whenReady(). Declares `ssmedia://` as a privileged,
 * read-only scheme so it behaves like a normal resource origin (usable as an
 * <img src>) without granting it any filesystem or node access.
 */
export function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_PROTOCOL, privileges: { standard: false, secure: true, supportFetchAPI: false, corsEnabled: false } }
  ])
}

export interface MediaProtocolDeps {
  getDatabase: () => Database | null
  getStorage: () => MediaStorage | null
}

/**
 * The renderer never receives a filesystem path or a generic file:// URL for
 * an image — only `ssmedia://<mediaId>`. The handler resolves that id through
 * the media repository (so an id with no matching row, or belonging to a
 * database that failed to open, serves nothing) and then re-validates the
 * stored relative path stays inside the managed media root before reading it,
 * mirroring the same guard delete uses. This is the entire renderer-facing
 * "filesystem access": read-only, and only for rows Solid Skill itself wrote.
 */
export function registerMediaProtocolHandler(deps: MediaProtocolDeps): void {
  protocol.handle(MEDIA_PROTOCOL, async (request) => {
    // Non-standard hostname parsing (ssmedia://<id>) — see registerMediaProtocolScheme.
    const id = new URL(request.url).hostname
    const db = deps.getDatabase()
    const storage = deps.getStorage()
    if (db === null || storage === null || id === '') {
      return new Response(null, { status: 404 })
    }
    const media = db.repositories.media.getById(id)
    if (media === null) return new Response(null, { status: 404 })
    // Read managed bytes directly rather than round-tripping through a
    // file:// fetch — one fewer URL-encoding surface on Windows paths, and
    // storage.read() already re-verifies the path stays inside the media root.
    const bytes = storage.read(media.managedPath)
    if (bytes === null) return new Response(null, { status: 404 })
    // Buffer's `buffer` property is typed ArrayBufferLike (it could in theory
    // be a SharedArrayBuffer), which the fetch BodyInit types reject even
    // though Electron accepts a Buffer/Uint8Array body at runtime. Uint8Array.from
    // copies into a fresh, plain ArrayBuffer, which satisfies the stricter type.
    return new Response(Uint8Array.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': MEDIA_CONTENT_TYPE[media.format],
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store'
      }
    })
  })
}
