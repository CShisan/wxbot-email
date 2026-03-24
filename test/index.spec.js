import { createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';

class MemoryKvNamespace {
	constructor(entries = []) {
		this.store = new Map(entries);
	}

	async get(key) {
		return this.store.has(key) ? this.store.get(key) : null;
	}

	async put(key, value) {
		this.store.set(key, value);
	}
}

function createTestEnv(overrides = {}) {
	return {
		"wxbot-email": new MemoryKvNamespace([
			['API_AUTH_TOKEN', 'initial-api-token'],
			['WX_CLOWBOT_BASE_URL', 'https://ilinkai.weixin.qq.com'],
			['WX_CLOWBOT_CHANNEL_VERSION', '1.0.2'],
			['WX_CLOWBOT_TOKEN', 'test-token'],
			['WX_CLOWBOT_USER_ID', 'wx-user-id'],
			['WX_CLOWBOT_CONTEXT_TOKEN', 'wx-context-token'],
		]),
		...overrides,
	};
}

function createAuthHeaders(token, headers = {}) {
	return {
		authorization: `Bearer ${token}`,
		...headers,
	};
}

function createRawEmail(subjectSuffix = '') {
	return `From: Alice <alice@example.com>
To: Bob <bob@example.com>
Cc: Carol <carol@example.com>
Subject: Worker Test ${subjectSuffix}
Message-ID: <${subjectSuffix || 'default'}@example.com>
Date: Mon, 23 Mar 2026 20:01:00 +0800
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="test-boundary"

--test-boundary
Content-Type: text/plain; charset="utf-8"

Hello from the worker.
This is a full raw email payload.

--test-boundary
Content-Type: text/plain; name="note.txt"
Content-Disposition: attachment; filename="note.txt"
Content-Transfer-Encoding: base64

SGVsbG8gYXR0YWNobWVudA==
--test-boundary--`;
}

function createJsonResponse(payload) {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: {
			'content-type': 'application/json',
		},
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('wxbot-email worker', () => {
	it('bootstraps the initial API auth token through /api/token/refresh when KV has no token yet', async () => {
		const env = createTestEnv({
			"wxbot-email": new MemoryKvNamespace([
				['WX_CLOWBOT_BASE_URL', 'https://ilinkai.weixin.qq.com'],
				['WX_CLOWBOT_CHANNEL_VERSION', '1.0.2'],
				['WX_CLOWBOT_TOKEN', 'test-token'],
				['WX_CLOWBOT_USER_ID', 'wx-user-id'],
				['WX_CLOWBOT_CONTEXT_TOKEN', 'wx-context-token'],
			]),
		});

		const response = await worker.fetch(
			new Request('https://example.com/api/token/refresh', {
				method: 'POST',
			}),
			env,
			createExecutionContext(),
		);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.ok).toBe(true);
		expect(body.initialized).toBe(true);
		expect(body.rotated).toBe(false);
		expect(body.token).toMatch(/^[0-9a-f]{64}$/);
		expect(await env['wxbot-email'].get('API_AUTH_TOKEN')).toBe(body.token);
	});

	it('rejects /api/email without a valid Bearer token', async () => {
		const outboundFetch = vi.fn();
		vi.stubGlobal('fetch', outboundFetch);

		const response = await worker.fetch(
			new Request('https://example.com/api/email', {
				method: 'POST',
				body: createRawEmail('unauthorized'),
			}),
			createTestEnv(),
			createExecutionContext(),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			error: 'Unauthorized',
		});
		expect(outboundFetch).not.toHaveBeenCalled();
	});

	it('updates WeChat config via /api/config and uses the new config for /api/email', async () => {
		const fetchThisValues = [];
		const outboundFetch = vi.fn(async function () {
			fetchThisValues.push(this);

			return new Response(JSON.stringify({ code: 0, message: 'ok' }), {
				status: 200,
				headers: {
					'content-type': 'application/json',
				},
			});
		});
		vi.stubGlobal('fetch', outboundFetch);

		const env = createTestEnv();
		const updateResponse = await worker.fetch(
			new Request('https://example.com/api/config', {
				method: 'PUT',
				headers: createAuthHeaders('initial-api-token', {
					'content-type': 'application/json',
				}),
				body: JSON.stringify({
					wxClowbotBaseUrl: 'https://example-wechat.invalid',
					wxClowbotToken: 'updated-clawbot-token',
					wxClowbotUserId: 'updated-user-id',
					wxClowbotContextToken: 'updated-context-token',
				}),
			}),
			env,
			createExecutionContext(),
		);

		expect(updateResponse.status).toBe(200);
		await expect(updateResponse.json()).resolves.toMatchObject({
			ok: true,
			updatedFields: [
				'wxClowbotBaseUrl',
				'wxClowbotToken',
				'wxClowbotUserId',
				'wxClowbotContextToken',
			],
			config: {
				wxClowbotBaseUrl: 'https://example-wechat.invalid',
				wxClowbotToken: 'updated-clawbot-token',
				wxClowbotUserId: 'updated-user-id',
				wxClowbotContextToken: 'updated-context-token',
			},
		});

		const emailResponse = await worker.fetch(
			new Request('https://example.com/api/email', {
				method: 'POST',
				headers: createAuthHeaders('initial-api-token', {
					'content-type': 'message/rfc822',
				}),
				body: createRawEmail('config-update'),
			}),
			env,
			createExecutionContext(),
		);

		expect(emailResponse.status).toBe(200);
		expect(outboundFetch).toHaveBeenCalledTimes(1);
		expect(fetchThisValues[0]).toBe(globalThis);

		const [url, init] = outboundFetch.mock.calls[0];
		expect(url).toBe('https://example-wechat.invalid/ilink/bot/sendmessage');

		const headers = new Headers(init.headers);
		expect(headers.get('Authorization')).toBe('Bearer updated-clawbot-token');

		const payload = JSON.parse(init.body);
		expect(payload.msg.to_user_id).toBe('updated-user-id');
		expect(payload.msg.context_token).toBe('updated-context-token');
	});

	it('sends a WeChat typing heartbeat from the scheduled handler', async () => {
		const outboundFetch = vi.fn(async () => createJsonResponse({ ret: 0 }));
		outboundFetch.mockImplementationOnce(async () => createJsonResponse({ ret: 0, typing_ticket: 'typing-ticket-123' }));
		vi.stubGlobal('fetch', outboundFetch);

		const env = createTestEnv();
		const controller = {
			cron: '*/1 * * * *',
			noRetry: vi.fn(),
			scheduledTime: Date.now(),
		};
		const executionContext = createExecutionContext();

		await worker.scheduled(controller, env, executionContext);
		await waitOnExecutionContext(executionContext);

		expect(outboundFetch).toHaveBeenCalledTimes(2);
		expect(controller.noRetry).not.toHaveBeenCalled();

		const [getConfigUrl, getConfigInit] = outboundFetch.mock.calls[0];
		expect(getConfigUrl).toBe('https://ilinkai.weixin.qq.com/ilink/bot/getconfig');
		expect(JSON.parse(getConfigInit.body)).toMatchObject({
			ilink_user_id: 'wx-user-id',
			context_token: 'wx-context-token',
		});

		const [sendTypingUrl, sendTypingInit] = outboundFetch.mock.calls[1];
		expect(sendTypingUrl).toBe('https://ilinkai.weixin.qq.com/ilink/bot/sendtyping');
		expect(JSON.parse(sendTypingInit.body)).toMatchObject({
			ilink_user_id: 'wx-user-id',
			typing_ticket: 'typing-ticket-123',
			status: 1,
		});
	});

	it('rotates the API auth token and invalidates the previous token', async () => {
		const env = createTestEnv();
		const rotateResponse = await worker.fetch(
			new Request('https://example.com/api/token/refresh', {
				method: 'POST',
				headers: createAuthHeaders('initial-api-token'),
			}),
			env,
			createExecutionContext(),
		);

		expect(rotateResponse.status).toBe(200);
		const rotateBody = await rotateResponse.json();
		expect(rotateBody.ok).toBe(true);
		expect(rotateBody.initialized).toBe(false);
		expect(rotateBody.rotated).toBe(true);
		expect(rotateBody.token).toMatch(/^[0-9a-f]{64}$/);
		expect(rotateBody.token).not.toBe('initial-api-token');

		const staleTokenResponse = await worker.fetch(
			new Request('https://example.com/api/config', {
				method: 'GET',
				headers: createAuthHeaders('initial-api-token'),
			}),
			env,
			createExecutionContext(),
		);
		expect(staleTokenResponse.status).toBe(401);

		const freshTokenResponse = await worker.fetch(
			new Request('https://example.com/api/config', {
				method: 'GET',
				headers: createAuthHeaders(rotateBody.token),
			}),
			env,
			createExecutionContext(),
		);
		expect(freshTokenResponse.status).toBe(200);
		await expect(freshTokenResponse.json()).resolves.toMatchObject({
			ok: true,
			config: {
				wxClowbotBaseUrl: 'https://ilinkai.weixin.qq.com',
			},
		});
	});

	it('exposes a public health endpoint and reports token/config readiness', async () => {
		const response = await SELF.fetch('https://example.com/health');

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			service: 'wxbot-email',
			ok: true,
			ready: false,
			configSource: {
				type: 'kv',
				binding: 'wxbot-email',
			},
			endpoints: {
				inboundEmail: '/api/email',
				config: '/api/config',
				tokenRefresh: '/api/token/refresh',
				health: '/health',
			},
		});
	});
});
