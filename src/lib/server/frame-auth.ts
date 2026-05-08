import { createHash, randomBytes } from 'node:crypto';

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePairingCode(length = 10) {
	const bytes = randomBytes(length);
	let out = '';
	for (let i = 0; i < length; i += 1) {
		out += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
	}
	return out;
}

export function generateFrameToken() {
	return randomBytes(32).toString('base64url');
}

export function tokenPrefix(rawToken: string) {
	return rawToken.slice(0, 12);
}

export function sha256Hex(value: string) {
	return createHash('sha256').update(value).digest('hex');
}
