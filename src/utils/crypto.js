function bytesToHex(bytes) {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encodeAsciiBase64(value) {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(value, 'utf-8').toString('base64');
	}

	return btoa(value);
}

export function generateApiAuthToken(byteLength = 32) {
	const randomBytes = crypto.getRandomValues(new Uint8Array(byteLength));
	return bytesToHex(randomBytes);
}

export function randomWechatUin() {
	const randomValue = crypto.getRandomValues(new Uint32Array(1))[0];
	return encodeAsciiBase64(String(randomValue));
}
