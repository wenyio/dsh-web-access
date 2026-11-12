import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function settingsFilePath(name) {
    const configured = process.env.DSH_HOME
    const home = configured?.trim()
        ? configured.replace(/^~(?=$|[\\/])/, () => homedir())
        : join(homedir(), '.dsh')
    return join(home, 'web-access', name)
}

export function isPort(value) {
    return Number.isInteger(value) && value >= 1 && value <= 65535
}

export function readPort(file, fallback) {
    try {
        const value = Number(readFileSync(file, 'utf8'))
        return isPort(value) ? value : fallback
    } catch (error) {
        if (error.code !== 'ENOENT') throw error
        return fallback
    }
}

export function readAutoLogin(file) {
    try {
        const value = readFileSync(file, 'utf8').trim()
        if (value === 'true' || value === 'false') return value === 'true'
        throw new Error('Invalid Harness web access auto-login setting')
    } catch (error) {
        if (error.code !== 'ENOENT') throw error
        return true
    }
}

export function saveSetting(file, value) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`
    try {
        writeFileSync(temporary, String(value), { mode: 0o600, flag: 'wx' })
        renameSync(temporary, file)
    } finally {
        rmSync(temporary, { force: true })
    }
}
