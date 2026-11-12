window.__ModuleLoader__.load({
    id: 'dsh-web-access',
    factory: require => {
        const { createElement: h, useEffect, useState, useSyncExternalStore } = require('react')
        const settingsPath = '/api/dsh-web-access/settings'
        // The host renders the README first. Keep this plugin's controls first for visual and keyboard navigation.
        const styles = `
            section[data-plugin-config]:has(.dsh-web-access-settings) {
                order: -1;
            }
            :has(> section[data-plugin-config] .dsh-web-access-settings) {
                reading-flow: flex-visual;
            }
            .dsh-web-access-settings {
                --web-access-primary-fill: var(--dsw-alias-button-primary-fill, light-dark(#0f1115, #fff));
                --web-access-primary-label: var(--dsw-alias-label-primary-inverted, light-dark(#fff, #0f1115));
                border: 1px solid var(--dsw-alias-settings-card-stroke, #8885);
                border-radius: var(--dsw-radius-lg, 16px);
                background: var(--dsw-alias-settings-card-fill, transparent);
            }
            .dsh-web-access-settings .web-access-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 10px 16px;
                padding: 12px 16px;
            }
            .dsh-web-access-settings .web-access-row + .web-access-row {
                border-top: 1px solid var(--dsw-alias-border-default, #8884);
            }
            .dsh-web-access-settings .web-access-label {
                font-weight: 600;
            }
            .dsh-web-access-settings .web-access-help,
            .dsh-web-access-settings .web-access-address {
                display: block;
                margin: 3px 0 0;
                color: var(--dsw-alias-label-secondary, currentColor);
                font-size: var(--dsw-font-xs-13-font-size, 13px);
                line-height: 1.5;
                overflow-wrap: anywhere;
            }
            .dsh-web-access-settings .web-access-actions {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
            }
            .dsh-web-access-settings button,
            .dsh-web-access-settings input[type="number"] {
                box-sizing: border-box;
                min-height: 34px;
                border: 1px solid var(--dsw-alias-settings-card-stroke, #8885);
                border-radius: 8px;
                background: var(--dsw-alias-bg-layer-1, transparent);
                color: inherit;
                font: inherit;
            }
            .dsh-web-access-settings input[type="number"] {
                width: 8ch;
                min-width: 80px;
                padding: 4px 8px;
                font-variant-numeric: tabular-nums;
            }
            .dsh-web-access-settings button {
                padding: 5px 12px;
                cursor: pointer;
            }
            .dsh-web-access-settings .web-access-primary {
                border-color: transparent;
                background: var(--web-access-primary-fill);
                color: var(--web-access-primary-label);
                font-weight: 600;
            }
            .dsh-web-access-settings button:not(:disabled):hover {
                filter: brightness(.93);
            }
            .dsh-web-access-settings :disabled {
                opacity: .5;
                cursor: default;
            }
            .dsh-web-access-settings :is(input, button):focus-visible {
                outline: 2px solid var(--dsw-alias-button-info-fill, #4176e6);
                outline-offset: 2px;
            }
            .dsh-web-access-settings input[role="switch"] {
                appearance: none;
                position: relative;
                box-sizing: border-box;
                flex: none;
                width: 38px;
                height: 22px;
                margin: 0;
                border: 1px solid var(--dsw-alias-settings-card-stroke, #8885);
                border-radius: 99px;
                background: var(--dsw-alias-state-idle-primary, #999);
                cursor: pointer;
            }
            .dsh-web-access-settings input[role="switch"]::before {
                content: '';
                position: absolute;
                inset: 2px auto 2px 2px;
                aspect-ratio: 1;
                border-radius: 50%;
                background: #fff;
            }
            .dsh-web-access-settings input[role="switch"]:checked {
                background: var(--web-access-primary-fill);
            }
            .dsh-web-access-settings input[role="switch"]:checked::before {
                inset-inline: auto 2px;
                background: var(--web-access-primary-label);
            }
            .dsh-web-access-settings .web-access-status {
                margin: 0;
                padding: 0 16px 12px;
                color: var(--dsw-alias-label-secondary, currentColor);
            }
            .dsh-web-access-settings .web-access-status:empty {
                position: absolute;
                padding: 0;
            }
        `

        function Settings({ locale, subscribe, getSnapshot }) {
            useSyncExternalStore(subscribe, getSnapshot)
            const [dictionaries, setDictionaries] = useState(null)
            const [origin, setOrigin] = useState('')
            const [port, setPort] = useState('')
            const [autoLogin, setAutoLogin] = useState(false)
            const [message, setMessage] = useState('')
            const [listenerError, setListenerError] = useState(null)
            const [loading, setLoading] = useState(true)
            const [busy, setBusy] = useState(false)

            useEffect(() => {
                const abort = new AbortController()
                void (async () => {
                    try {
                        const response = await fetch('/api/dsh-web-access/locale', { signal: abort.signal })
                        if (!response.ok) throw new Error(String(response.status))
                        const catalog = await response.json()
                        if (!abort.signal.aborted) setDictionaries(catalog)
                    } catch (error) {
                        if (!abort.signal.aborted) console.error('dsh-web-access', error)
                    }
                })()
                void (async () => {
                    try {
                        const response = await fetch(settingsPath, { signal: abort.signal })
                        if (!response.ok) throw new Error()
                        const settings = await response.json()
                        setOrigin(settings.origin)
                        setPort(String(settings.port))
                        setAutoLogin(settings.autoLogin)
                        setListenerError(settings.error)
                    } catch {
                        if (!abort.signal.aborted) setMessage('readFailed')
                    } finally {
                        if (!abort.signal.aborted) setLoading(false)
                    }
                })()
                return () => abort.abort()
            }, [])

            async function openBrowser() {
                if (autoLogin) {
                    window.open(origin + '/', '_blank', 'noopener,noreferrer')
                    return
                }
                setBusy(true)
                try {
                    const response = await fetch('/api/dsh-web-access/launch', { method: 'POST' })
                    if (!response.ok) throw new Error()
                    const { url } = await response.json()
                    window.open(url, '_blank', 'noopener,noreferrer')
                } catch {
                    setMessage('openFailed')
                } finally {
                    setBusy(false)
                }
            }

            async function changeAutoLogin(event) {
                const enabled = event.target.checked
                setBusy(true)
                try {
                    const response = await fetch('/api/dsh-web-access/auto-login', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ enabled }),
                    })
                    if (!response.ok) throw new Error()
                    setAutoLogin((await response.json()).autoLogin)
                    setMessage('autoLoginSaved')
                } catch {
                    setMessage('autoLoginSaveFailed')
                } finally {
                    setBusy(false)
                }
            }

            async function savePort(event) {
                event.preventDefault()
                setBusy(true)
                try {
                    const response = await fetch(settingsPath, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ port: Number(port) }),
                    })
                    if (response.status === 409) {
                        setMessage('portInUse')
                        return
                    }
                    if (!response.ok) throw new Error()
                    const settings = await response.json()
                    setOrigin(settings.origin)
                    setPort(String(settings.port))
                    setListenerError(settings.error)
                    setMessage('portSaved')
                } catch {
                    setMessage('portSaveFailed')
                } finally {
                    setBusy(false)
                }
            }

            if (!dictionaries) return null
            const t = key => locale.resolveText({ en: dictionaries.en[key], zh: dictionaries.zh[key] })

            return h('section', { className: 'dsh-web-access-settings', 'aria-label': t('title') },
                h('style', null, styles),
                h('div', { className: 'web-access-row' },
                    h('div', null,
                        h('div', { className: 'web-access-label' }, t('address')),
                        origin
                            ? h('code', { className: 'web-access-address' }, origin + '/')
                            : h('p', { className: 'web-access-help' }, t(loading ? 'loadingAddress' : 'unavailableAddress')),
                    ),
                    h('button', {
                        className: 'web-access-primary', type: 'button', onClick: openBrowser, disabled: !origin || busy,
                    }, t('openBrowser')),
                ),
                h('div', { className: 'web-access-row' },
                    h('div', null,
                        h('label', { className: 'web-access-label', htmlFor: 'dsh-web-access-auto-login' }, t('autoLogin')),
                        h('p', { className: 'web-access-help', id: 'dsh-web-access-auto-login-hint' },
                            t(autoLogin ? 'autoLoginOn' : 'autoLoginOff')),
                    ),
                    h('input', {
                        id: 'dsh-web-access-auto-login', type: 'checkbox', role: 'switch',
                        checked: autoLogin, disabled: busy || !origin,
                        onChange: changeAutoLogin, 'aria-describedby': 'dsh-web-access-auto-login-hint',
                    }),
                ),
                h('form', { className: 'web-access-row', onSubmit: savePort },
                    h('label', { className: 'web-access-label', htmlFor: 'dsh-web-access-port' }, t('port')),
                    h('div', { className: 'web-access-actions' },
                        h('input', {
                            id: 'dsh-web-access-port', type: 'number', min: 1, max: 65535,
                            required: true, value: port, disabled: loading || busy,
                            onChange: event => setPort(event.target.value),
                        }),
                        h('button', { className: 'web-access-primary', type: 'submit', disabled: loading || busy }, t('save')),
                    ),
                ),
                listenerError ? h('p', { className: 'web-access-status', role: 'alert' }, t(listenerError)) : null,
                h('p', { className: 'web-access-status', role: 'status' }, message && t(message)),
            )
        }

        return {
            inject: ['slots', 'locale'],
            apply(ctx) {
                const locale = ctx.locale
                const subscribe = listener => locale.subscribe(listener)
                const getSnapshot = () => locale.getSnapshot()
                ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
                    name: 'plugins.bundle.config',
                    key: 'dsh-web-access',
                }, () => h(Settings, { locale, subscribe, getSnapshot })))
            },
        }
    },
})
