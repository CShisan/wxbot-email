import { getApiAuthToken, setApiAuthToken } from '../config.js';
import { generateApiAuthToken } from '../utils/crypto.js';
import { jsonResponse, serviceUnavailable } from '../utils/http.js';

function unauthorizedResponse(message) {
	return jsonResponse(
		{
			error: 'Unauthorized',
			message,
		},
		{
			status: 401,
			headers: {
				'WWW-Authenticate': 'Bearer',
			},
		},
	);
}

function tokenNotInitializedResponse() {
	return jsonResponse(
		{
			error: 'API auth token is not initialized',
			message: 'Call POST /api/token/refresh first to create the initial API auth token.',
		},
		{
			status: 503,
		},
	);
}

function extractBearerToken(request) {
	const authorization = request.headers.get('authorization');

	if (!authorization) {
		return null;
	}

	const [scheme, token] = authorization.split(/\s+/, 2);

	if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
		return null;
	}

	return token.trim() || null;
}

export async function authenticateApiRequest(request, env) {
	let currentToken;

	try {
		currentToken = await getApiAuthToken(env);
	} catch (error) {
		return {
			ok: false,
			response: serviceUnavailable(error instanceof Error ? error.message : 'Config store is unavailable.'),
		};
	}

	if (!currentToken) {
		return {
			ok: false,
			response: tokenNotInitializedResponse(),
		};
	}

	const providedToken = extractBearerToken(request);

	if (!providedToken) {
		return {
			ok: false,
			response: unauthorizedResponse('Missing Bearer token.'),
		};
	}

	if (providedToken !== currentToken) {
		return {
			ok: false,
			response: unauthorizedResponse('Invalid API auth token.'),
		};
	}

	return {
		ok: true,
		token: currentToken,
	};
}

export async function refreshApiAuthToken(request, env) {
	let currentToken;

	try {
		currentToken = await getApiAuthToken(env);
	} catch (error) {
		return {
			ok: false,
			response: serviceUnavailable(error instanceof Error ? error.message : 'Config store is unavailable.'),
		};
	}

	if (currentToken) {
		const authResult = await authenticateApiRequest(request, env);

		if (!authResult.ok) {
			return authResult;
		}
	}

	const token = generateApiAuthToken();

	try {
		await setApiAuthToken(env, token);
	} catch (error) {
		return {
			ok: false,
			response: serviceUnavailable(error instanceof Error ? error.message : 'Config store is unavailable.'),
		};
	}

	return {
		ok: true,
		token,
		initialized: !currentToken,
		rotated: Boolean(currentToken),
	};
}
