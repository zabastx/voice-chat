// Updater signing, as the harnesses need it. The release key is a secret of the
// `desktop-release` GitHub Environment and never lives in this repo; a harness that has to
// prove the signed path therefore mints its own throwaway pair per run.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

function signer(args: string[]) {
	// The Tauri CLI folds these environment variables into its own `--private-key`
	// option, which collides with the `--private-key-path` we pass explicitly and
	// fails with "cannot be used with". The arguments here are the only source of
	// truth, so the ambient signing variables are dropped for the call.
	const env = { ...process.env, CI: '1' }
	delete env.TAURI_SIGNING_PRIVATE_KEY
	delete env.TAURI_SIGNING_PRIVATE_KEY_PATH
	return execFileSync(process.execPath, [cli, 'signer', ...args], {
		cwd: root,
		encoding: 'utf8',
		env
	})
}

export interface UpdaterKeyPair {
	/** what a build stamps in as `VOICECHAT_DESKTOP_UPDATER_PUBKEY` */
	publicKey: string
	/** what `signArtifact` signs with */
	privateKeyPath: string
}

/**
 * Mints a throwaway updater key pair inside `directory`, or returns the one already there.
 * Reuse matters to a harness that skips the build: an artifact only verifies against the
 * key its build was stamped with.
 */
export function generateUpdaterKey(directory: string): UpdaterKeyPair {
	const privateKeyPath = join(directory, 'updater.key')
	const publicKeyPath = `${privateKeyPath}.pub`
	if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
		signer(['generate', '--ci', '--password', '', '--force', '--write-keys', privateKeyPath])
	}
	if (!existsSync(publicKeyPath)) throw new Error('Tauri signer did not write a public key')
	return { publicKey: readFileSync(publicKeyPath, 'utf8').trim(), privateKeyPath }
}

/**
 * Signs one artifact and returns the signature the update manifest carries. The
 * release key has a password; a throwaway harness key is generated without one.
 */
export function signArtifact(key: UpdaterKeyPair, artifact: string, password = ''): string {
	signer(['sign', '--private-key-path', key.privateKeyPath, '--password', password, artifact])
	const signaturePath = `${artifact}.sig`
	if (!existsSync(signaturePath)) throw new Error(`Tauri signer did not sign ${artifact}`)
	return readFileSync(signaturePath, 'utf8').trim()
}
