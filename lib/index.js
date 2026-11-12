import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isIPv4 } from 'node:net'
import { isPort, readAutoLogin, readPort, saveSetting, settingsFilePath } from './settings.js'
import { createBrowserRelay } from './relay.js'
import en from '../locale/en.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }

const browserHost = '127.0.0.1'
const defaultPort = 53197
const authorizationPath = '/__dsh-web-access/authorize'
const ticketLifetime = 60 * 1000
const noStore = { 'cache-control': 'no-store' }
const dictionaries = { en, zh }

export const inject = ['webServer', 'connection']

function authorizationPage(response, request, status) {
    const languages = (request.headers['accept-language'] ?? '').split(',').map(entry => {
        const [tag, weight] = entry.trim().toLowerCase().split(/\s*;\s*/, 2)
        return { language: tag.split('-')[0], quality: weight?.startsWith('q=') ? Number(weight.slice(2)) : 1 }
    })
    const language = languages
        .filter(({ language, quality }) => Object.hasOwn(dictionaries, language) && quality > 0 && quality <= 1)
        .sort((left, right) => right.quality - left.quality)[0]?.language ?? 'en'
    const { title, heading, instructions } = dictionaries[language].authorization
    response.writeHead(status, {
        ...noStore,
        'content-type': 'text/html; charset=utf-8',
        'content-language': language,
        vary: 'Accept-Language',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
    })
    response.end(request.method === 'HEAD' ? undefined : `<!doctype html>
<html lang="${language}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
        :root { color-scheme: light dark; font: 16px system-ui, sans-serif; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
        main { box-sizing: border-box; width: min(100% - 32px, 400px); padding: 28px; border: 1px solid #8888; border-radius: 14px; }
        h1 { font-size: 1.5rem; margin: 0; }
        p { line-height: 1.6; }
    </style>
</head>
<body>
    <main>
        <h1>${heading}</h1>
        <p>${instructions}</p>
    </main>
</body>
</html>`)
}

/** Serve the same Host and start a native browser session according to the login setting. */
export function apply(ctx) {
    const portFile = settingsFilePath('port')
    const autoLoginFile = settingsFilePath('auto-login')
    let configuredPort = defaultPort
    let autoLogin = false
    let active
    let target
    let listenerError = null
    let ticket
    let stopped = false
    let pendingSwitch = Promise.resolve()

    function login(origin, res) {
        // Harness signs the cookie for the browser's fixed Host, including its port.
        const nativeUrl = ctx.connection.authenticatedUrl(origin.origin)
        const nativeRequest = new Request(nativeUrl, { headers: { host: origin.host } })
        const admitted = ctx.connection.authorizeIndex(nativeRequest, {
            writeHead(status, headers) {
                res.writeHead(status, { ...headers, ...noStore, 'referrer-policy': 'no-referrer',
                    ...(status === 303 ? { location: '/' } : {}),
                })
            },
            end(body) { res.end(body) },
        })
        if (admitted) res.writeHead(500).end()
    }

    function authorize(origin, req, res, url) {
        const supplied = Buffer.from(url.searchParams.get('ticket') ?? '')
        if (req.method !== 'GET' || active?.origin !== origin || !ticket || Date.now() >= ticket.expiresAt
            || supplied.length !== ticket.value.length || !timingSafeEqual(supplied, ticket.value)) {
            authorizationPage(res, req, 403)
            return
        }
        ticket = undefined
        login(origin, res)
    }

    async function switchPort(port, persist) {
        if (stopped) throw new Error('Harness web access is stopped')
        if (active?.port === port) {
            if (persist) saveSetting(portFile, port)
            return
        }
        const origin = new URL(`http://${browserHost}:${port}`)
        const relay = createBrowserRelay({
            origin,
            target,
            authorizationPath,
            showLogin(req, res) {
                const mode = req.headers['sec-fetch-mode']
                const destination = req.headers['sec-fetch-dest']
                if (active?.origin === origin && autoLogin && req.method === 'GET'
                    && (!mode || mode === 'navigate') && (!destination || destination === 'document')) {
                    login(origin, res)
                } else {
                    authorizationPage(res, req, 401)
                }
            },
            authorize: (req, res, url) => authorize(origin, req, res, url),
        })
        try {
            await relay.listen(browserHost, port)
            if (stopped) throw new Error('Harness web access is stopped')
            if (persist) saveSetting(portFile, port)
        } catch (error) {
            relay.close()
            throw error
        }
        relay.server.on('error', error => {
            if (active?.relay === relay) {
                active = undefined
                listenerError = 'LISTEN_FAILED'
                ticket = undefined
                relay.close()
            }
            ctx.logger.warn(error)
        })
        const previous = active
        active = { relay, origin, port }
        configuredPort = port
        listenerError = null
        ticket = undefined
        previous?.relay.retire()
    }

    function queueSwitch(port, persist) {
        // Serialize binding and persistence across settings requests and plugin startup.
        const switched = pendingSwitch.then(() => switchPort(port, persist))
        pendingSwitch = switched.catch(() => {})
        return switched
    }

    function settingsResponse() {
        return Response.json({
            origin: active?.origin.origin ?? null,
            port: configuredPort,
            autoLogin,
            error: listenerError,
        }, { headers: noStore })
    }

    ctx.effect(() => {
        const origin = new URL(ctx.webServer.getOrigin())
        const host = origin.hostname
        if (origin.protocol !== 'http:' || !((isIPv4(host) && host.startsWith('127.')) || host === '[::1]')) {
            listenerError = 'UNSUPPORTED_HOST'
            return
        }
        target = origin
        try {
            autoLogin = readAutoLogin(autoLoginFile)
        } catch (error) {
            ctx.logger.warn(error)
        }
        try {
            configuredPort = readPort(portFile, defaultPort)
            void queueSwitch(configuredPort, false).catch(error => {
                if (stopped) return
                listenerError = error.code === 'EADDRINUSE' ? 'EADDRINUSE' : 'LISTEN_FAILED'
                ctx.logger.warn(error)
            })
        } catch (error) {
            listenerError = 'CONFIG_UNREADABLE'
            ctx.logger.warn(error)
        }
        return () => {
            stopped = true
            ticket = undefined
            active?.relay.close()
            active = undefined
        }
    })

    ctx.effect(() => ctx.connection.fetch.register({
        path: '/api/dsh-web-access/locale',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch() {
            return Response.json({ en: en.settings, zh: zh.settings }, { headers: noStore })
        },
    }))

    ctx.effect(() => ctx.connection.fetch.register({
        path: '/api/dsh-web-access/settings',
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        async fetch(request) {
            if (request.method === 'GET') return settingsResponse()
            let port
            try { ({ port } = await request.json()) } catch {
                return new Response(null, { status: 400 })
            }
            if (!isPort(port)) return new Response(null, { status: 400 })
            if (!target) return new Response(null, { status: 422 })
            try {
                await queueSwitch(port, true)
            } catch (error) {
                if (!stopped) ctx.logger.warn(error)
                return new Response(null, { status: error.code === 'EADDRINUSE' ? 409 : 422 })
            }
            return settingsResponse()
        },
    }))

    ctx.effect(() => ctx.connection.fetch.register({
        path: '/api/dsh-web-access/auto-login',
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
            let enabled
            try { ({ enabled } = await request.json()) } catch {
                return new Response(null, { status: 400 })
            }
            if (typeof enabled !== 'boolean') return new Response(null, { status: 400 })
            try {
                saveSetting(autoLoginFile, enabled)
            } catch (error) {
                ctx.logger.warn(error)
                return new Response(null, { status: 422 })
            }
            autoLogin = enabled
            ticket = undefined
            return settingsResponse()
        },
    }))

    ctx.effect(() => ctx.connection.fetch.register({
        path: '/api/dsh-web-access/launch',
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch() {
            if (!active) return new Response(null, { status: 503 })
            const url = new URL(authorizationPath, active.origin)
            const value = randomBytes(24).toString('base64url')
            ticket = { value: Buffer.from(value), expiresAt: Date.now() + ticketLifetime }
            url.searchParams.set('ticket', value)
            return Response.json({ url: url.href }, { headers: noStore })
        },
    }))
}
