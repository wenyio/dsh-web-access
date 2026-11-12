import { createServer, request } from 'node:http'
import { once } from 'node:events'

const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']

function forwardedHeaders(headers) {
    const forwarded = { ...headers }
    const connectionHeaders = headers.connection?.toLowerCase().split(',').map(name => name.trim()) ?? []
    for (const name of [...hopHeaders, ...connectionHeaders]) delete forwarded[name]
    return forwarded
}

function allowedRequest(req, origin) {
    return req.headers.host === origin.host
        && (req.headers.origin === undefined || req.headers.origin === origin.origin)
        && req.url?.startsWith('/') && !req.url.startsWith('//')
}

function requestHeaders(req) {
    const headers = forwardedHeaders(req.headers)
    for (const name of Object.keys(headers)) {
        if (name === 'forwarded' || name.startsWith('x-forwarded-')) delete headers[name]
    }
    headers.host = req.headers.host
    if (req.headers.origin !== undefined) headers.origin = req.headers.origin
    return headers
}

function proxyFailure(res) {
    if (res.destroyed || res.writableEnded) return
    if (res.headersSent) res.destroy()
    else res.writeHead(502).end()
}

function proxyHttp(target, req, res, onUnauthorized) {
    const upstream = request(target, {
        method: req.method,
        path: req.url,
        headers: requestHeaders(req),
    }, response => {
        response.on('error', () => proxyFailure(res))
        if (response.statusCode === 401 && onUnauthorized) {
            response.resume()
            try {
                onUnauthorized()
            } catch {
                proxyFailure(res)
            }
            return
        }
        res.writeHead(response.statusCode, forwardedHeaders(response.headers))
        response.pipe(res)
    })
    upstream.on('error', () => proxyFailure(res))
    res.on('close', () => {
        if (!res.writableFinished) upstream.destroy()
    })
    req.on('error', () => upstream.destroy())
    req.pipe(upstream)
}

function proxyWebSocket(target, req, socket, head) {
    const reject = status => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    const upstream = request(target, {
        path: req.url,
        headers: { ...requestHeaders(req), connection: 'Upgrade', upgrade: 'websocket' },
    })
    upstream.on('error', () => reject('502 Bad Gateway'))
    upstream.on('response', response => {
        response.resume()
        reject(`${response.statusCode} ${response.statusMessage}`)
    })
    upstream.on('upgrade', (response, remote, initial) => {
        if (socket.destroyed) {
            remote.destroy()
            return
        }
        const headers = []
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
            headers.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`)
        }
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join('\r\n')}\r\n\r\n`)
        if (initial.length) socket.write(initial)
        if (head.length) remote.write(head)
        socket.on('close', () => remote.destroy())
        remote.on('error', () => socket.destroy())
        remote.on('close', () => socket.destroy())
        socket.pipe(remote).pipe(socket)
    })
    socket.on('close', () => upstream.destroy())
    upstream.end()
}

/** Bind a browser-only listener and keep the browser authority when forwarding to the native Host. */
export function createBrowserRelay({ origin, target, authorizationPath, authorize, showLogin }) {
    const sockets = new Set()
    const upgrades = new Set()
    let retiring = false
    const server = createServer((req, res) => {
        if (retiring) {
            res.writeHead(503, { connection: 'close' }).end()
            return
        }
        if (!allowedRequest(req, origin)) {
            res.writeHead(403).end()
            return
        }
        if (req.url === authorizationPath || req.url.startsWith(authorizationPath + '?')) {
            try {
                authorize(req, res, new URL(req.url, origin))
            } catch {
                proxyFailure(res)
            }
        } else {
            const showOnUnauthorized = req.url === '/' && ['GET', 'HEAD'].includes(req.method)
            proxyHttp(target, req, res, showOnUnauthorized ? () => showLogin(req, res) : undefined)
        }
    })
    server.on('connection', socket => {
        sockets.add(socket)
        socket.on('error', () => socket.destroy())
        socket.on('close', () => sockets.delete(socket))
    })
    server.on('upgrade', (req, socket, head) => {
        if (retiring || !allowedRequest(req, origin) || req.headers.origin !== origin.origin
            || req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
            return
        }
        upgrades.add(socket)
        socket.once('close', () => upgrades.delete(socket))
        proxyWebSocket(target, req, socket, head)
    })

    function close() {
        server.close()
        for (const socket of sockets) socket.destroy()
    }

    return {
        server,
        async listen(host, port) {
            server.listen({ host, port, exclusive: true })
            await once(server, 'listening')
        },
        close,
        retire() {
            retiring = true
            // A save submitted through this relay still needs its HTTP reply.
            const timeout = setTimeout(close, 2000).unref()
            server.close(() => clearTimeout(timeout))
            for (const socket of upgrades) socket.destroy()
        },
    }
}
