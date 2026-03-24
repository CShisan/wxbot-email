export function jsonResponse(payload, init = {}) {
	const headers = new Headers(init.headers);
	headers.set('content-type', 'application/json; charset=utf-8');

	return new Response(JSON.stringify(payload), {
		...init,
		headers,
	});
}

export function methodNotAllowed(allowedMethods) {
	return jsonResponse(
		{
			error: 'Method not allowed',
			allowedMethods,
		},
		{
			status: 405,
			headers: {
				Allow: allowedMethods.join(', '),
			},
		},
	);
}

export function badRequest(message) {
	return jsonResponse(
		{
			error: 'Bad request',
			message,
		},
		{
			status: 400,
		},
	);
}

export function serviceUnavailable(message) {
	return jsonResponse(
		{
			error: 'Service unavailable',
			message,
		},
		{
			status: 503,
		},
	);
}

export function notFound() {
	return jsonResponse(
		{
			error: 'Not found',
		},
		{
			status: 404,
		},
	);
}
