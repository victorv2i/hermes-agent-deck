/**
 * Files BFF route plugin — mounts the workspace file surface.
 *
 * Mount base: `/api/agent-deck` (the integrator registers this plugin with that
 * prefix), giving the spec's routes:
 *   GET  /api/agent-deck/files/roots
 *   GET  /api/agent-deck/files?root&path
 *   GET  /api/agent-deck/files/read?root&path
 *   POST /api/agent-deck/files/write    { root, path, content }
 *   POST /api/agent-deck/files/create   { root, path, kind: 'file'|'dir' }
 *   POST /api/agent-deck/files/rename   { root, from, to }
 *   POST /api/agent-deck/files/delete   { root, path }
 *
 * READS proxy the dashboard; WRITES go straight to disk via {@link FilesService}
 * (the dashboard is read-only). Every path is PATH-GUARDED inside the service;
 * this layer only validates request shape and maps errors to HTTP status:
 *   PathGuardError      → 403 (traversal / outside-root / sensitive)
 *   FilesServiceError   → 404 (not_found) | 409 (conflict) | 403 (read_only) | 400 (invalid)
 *   anything else       → 502 (dashboard/upstream failure)
 *
 * SECURITY: error messages echo only the client-supplied path, never file
 * contents or the dashboard session token.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import { FilesService, FilesServiceError } from './filesService'
import { PathGuardError } from './pathGuard'

export interface FilesRoutesOptions {
  /** A constructed FilesService (its DashboardClient already bound). */
  service: FilesService
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** Map a thrown error to an HTTP reply. Keeps messages path-only (no secrets). */
function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof PathGuardError) {
    return reply.code(403).send({ error: 'forbidden', code: err.code, message: err.message })
  }
  if (err instanceof FilesServiceError) {
    const status =
      err.code === 'not_found'
        ? 404
        : err.code === 'conflict'
          ? 409
          : err.code === 'read_only'
            ? 403
            : 400
    return reply.code(status).send({ error: err.code, message: err.message })
  }
  // Upstream (dashboard) or unexpected failure. Do not leak internals.
  return reply.code(502).send({ error: 'upstream_error', message: 'workspace request failed' })
}

export const filesRoutes: FastifyPluginAsync<FilesRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service } = opts

  app.get('/files/roots', async (_req, reply) => {
    try {
      return await reply.send({ roots: await service.listRoots() })
    } catch (err) {
      return sendError(reply, err)
    }
  })

  app.get('/files', async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = str(q.root)
    if (!root) return reply.code(400).send({ error: 'bad_request', message: 'root is required' })
    const path = str(q.path) ?? ''
    try {
      return await reply.send(await service.listDirectory(root, path))
    } catch (err) {
      return sendError(reply, err)
    }
  })

  app.get('/files/raw', async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = str(q.root)
    const path = str(q.path)
    if (!root || !path) {
      return reply.code(400).send({ error: 'bad_request', message: 'root and path are required' })
    }
    try {
      const { data, contentType } = await service.readRaw(root, path)
      // Inline image only; a strict CSP neutralizes any script embedded in an SVG.
      return await reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', 'inline')
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'no-store')
        .send(data)
    } catch (err) {
      return sendError(reply, err)
    }
  })

  app.get('/files/download', async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = str(q.root)
    const path = str(q.path)
    if (!root || !path) {
      return reply.code(400).send({ error: 'bad_request', message: 'root and path are required' })
    }
    try {
      const { data, filename } = await service.downloadFile(root, path)
      // Force a download (never inline-render): octet-stream + attachment, with
      // an RFC 5987 filename* fallback so unicode names survive. nosniff + a
      // locked-down CSP keep the browser from interpreting the bytes.
      const asciiName = filename.replace(/["\\\r\n]/g, '_')
      const encoded = encodeURIComponent(filename)
      return await reply
        .header('Content-Type', 'application/octet-stream')
        .header(
          'Content-Disposition',
          `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
        )
        .header('Content-Security-Policy', "default-src 'none'")
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'no-store')
        .send(data)
    } catch (err) {
      return sendError(reply, err)
    }
  })

  app.get('/files/read', async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = str(q.root)
    const path = str(q.path)
    if (!root || path === null) {
      return reply.code(400).send({ error: 'bad_request', message: 'root and path are required' })
    }
    try {
      return await reply.send(await service.readFile(root, path))
    } catch (err) {
      return sendError(reply, err)
    }
  })

  app.post('/files/write', async (req, reply) => {
    const b = req.body
    if (!isRecord(b)) return reply.code(400).send({ error: 'bad_request' })
    const root = str(b.root)
    const path = str(b.path)
    const content = str(b.content)
    if (!root || !path || content === null) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'root, path and content are required' })
    }
    try {
      return await reply.send(await service.writeFile(root, path, content))
    } catch (err) {
      return sendError(reply, err)
    }
  })

  app.post('/files/create', async (req, reply) => {
    const b = req.body
    if (!isRecord(b)) return reply.code(400).send({ error: 'bad_request' })
    const root = str(b.root)
    const path = str(b.path)
    const kind = str(b.kind)
    if (!root || !path || (kind !== 'file' && kind !== 'dir')) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: "root, path and kind ('file'|'dir') are required" })
    }
    try {
      return await reply.send(await service.createEntry(root, path, kind))
    } catch (err) {
      return sendError(reply, err)
    }
  })

  app.post('/files/rename', async (req, reply) => {
    const b = req.body
    if (!isRecord(b)) return reply.code(400).send({ error: 'bad_request' })
    const root = str(b.root)
    const from = str(b.from)
    const to = str(b.to)
    if (!root || !from || !to) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'root, from and to are required' })
    }
    try {
      return await reply.send(await service.renameEntry(root, from, to))
    } catch (err) {
      return sendError(reply, err)
    }
  })

  app.post('/files/delete', async (req, reply) => {
    const b = req.body
    if (!isRecord(b)) return reply.code(400).send({ error: 'bad_request' })
    const root = str(b.root)
    const path = str(b.path)
    if (!root || !path) {
      return reply.code(400).send({ error: 'bad_request', message: 'root and path are required' })
    }
    try {
      return await reply.send(await service.deleteEntry(root, path))
    } catch (err) {
      return sendError(reply, err)
    }
  })
}

export default filesRoutes
