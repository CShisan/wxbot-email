import { authenticateApiRequest, refreshApiAuthToken } from './auth/api-auth.js';
import {
	getApiAuthToken,
	getAppConfig,
	getConfigFieldNames,
	getWechatConfigSnapshot,
	updateWechatConfig,
} from './config.js';
import { WechatClawbotClient } from './clients/wechat-clawbot.js';
import { formatEmailNotification } from './email/format-email-notification.js';
import { parseRawEmail } from './email/parse-email.js';
import { badRequest, jsonResponse, methodNotAllowed, notFound } from './utils/http.js';

const INBOUND_EMAIL_PATH = '/api/email';
const CONFIG_PATH = '/api/config';
const TOKEN_REFRESH_PATH = '/api/token/refresh';
const HEALTH_PATH = '/health';

async function readJsonBody(request) {
	try {
		return await request.json();
	} catch {
		throw new Error('Request body must be valid JSON.');
	}
}

async function requireApiAuth(request, env) {
	const authResult = await authenticateApiRequest(request, env);

	if (!authResult.ok) {
		return authResult.response;
	}

	return null;
}

async function handleInboundEmailRequest(request, env) {
	if (request.method !== 'POST') {
		return methodNotAllowed(['POST']);
	}

	const authFailureResponse = await requireApiAuth(request, env);

	if (authFailureResponse) {
		return authFailureResponse;
	}

	let config;

	try {
		config = await getAppConfig(env);
	} catch (error) {
		return jsonResponse(
			{
				error: 'WeChat config is incomplete',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			{
				status: 503,
			},
		);
	}

	const rawEmail = await request.arrayBuffer();

	if (rawEmail.byteLength === 0) {
		return badRequest('Request body is empty.');
	}

	let emailSummary;

	try {
		emailSummary = await parseRawEmail(rawEmail);
	} catch (error) {
		return badRequest(error instanceof Error ? `Failed to parse raw email: ${error.message}` : 'Failed to parse raw email.');
	}

	const notificationChunks = formatEmailNotification(emailSummary);
	const clawbotClient = new WechatClawbotClient(config);

	try {
		const deliveryResults = await clawbotClient.sendTextMessages(notificationChunks);

		return jsonResponse({
			ok: true,
			messageId: emailSummary.messageId,
			chunkCount: notificationChunks.length,
			wxClientIds: deliveryResults.map((result) => result.clientId),
		});
	} catch (error) {
		return jsonResponse(
			{
				error: 'Failed to deliver email to WeChat clawbot',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			{
				status: 502,
			},
		);
	}
}

async function handleConfigRequest(request, env) {
	if (request.method !== 'GET' && request.method !== 'PUT') {
		return methodNotAllowed(['GET', 'PUT']);
	}

	const authFailureResponse = await requireApiAuth(request, env);

	if (authFailureResponse) {
		return authFailureResponse;
	}

	if (request.method === 'GET') {
		const config = await getWechatConfigSnapshot(env);

		return jsonResponse({
			ok: true,
			config,
		});
	}

	let payload;

	try {
		payload = await readJsonBody(request);
	} catch (error) {
		return badRequest(error instanceof Error ? error.message : 'Invalid JSON payload.');
	}

	try {
		const config = await updateWechatConfig(env, payload);

		return jsonResponse({
			ok: true,
			updatedFields: Object.keys(payload),
			config,
		});
	} catch (error) {
		return badRequest(
			error instanceof Error
				? `${error.message} Allowed fields: ${getConfigFieldNames().join(', ')}`
				: 'Invalid config update payload.',
		);
	}
}

async function handleTokenRefreshRequest(request, env) {
	if (request.method !== 'POST') {
		return methodNotAllowed(['POST']);
	}

	const refreshResult = await refreshApiAuthToken(request, env);

	if (!refreshResult.ok) {
		return refreshResult.response;
	}

	return jsonResponse({
		ok: true,
		token: refreshResult.token,
		initialized: refreshResult.initialized,
		rotated: refreshResult.rotated,
	});
}

async function handleHealthRequest(request, env) {
	if (request.method !== 'GET') {
		return methodNotAllowed(['GET']);
	}

	let hasApiAuthToken = false;
	let hasWechatConfig = false;

	try {
		hasApiAuthToken = Boolean(await getApiAuthToken(env));
	} catch {}

	try {
		await getAppConfig(env);
		hasWechatConfig = true;
	} catch {}

	return jsonResponse({
		service: 'wxbot-email',
		ok: true,
		ready: hasApiAuthToken && hasWechatConfig,
		configSource: {
			type: 'kv',
			binding: 'wxbot-email',
		},
		endpoints: {
			inboundEmail: INBOUND_EMAIL_PATH,
			config: CONFIG_PATH,
			tokenRefresh: TOKEN_REFRESH_PATH,
			health: HEALTH_PATH,
		},
	});
}

async function sendWechatTypingHeartbeat(env) {
	const config = await getAppConfig(env);
	const clawbotClient = new WechatClawbotClient(config);

	return clawbotClient.sendTypingHeartbeat();
}

async function handleScheduledTypingHeartbeat(controller, env) {
	try {
		const result = await sendWechatTypingHeartbeat(env);
		console.log('Scheduled WeChat typing heartbeat sent', {
			cron: controller.cron,
			status: result.response?.ret ?? 0,
		});
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith('Missing required KV config:') &&
			typeof controller.noRetry === 'function'
		) {
			controller.noRetry();
		}

		console.error('Scheduled WeChat typing heartbeat failed', error);
		throw error;
	}
}

export default {
	async fetch(request, env) {
		try {
			const { pathname } = new URL(request.url);

			if (pathname === INBOUND_EMAIL_PATH) {
				return handleInboundEmailRequest(request, env);
			}

			if (pathname === CONFIG_PATH) {
				return handleConfigRequest(request, env);
			}

			if (pathname === TOKEN_REFRESH_PATH) {
				return handleTokenRefreshRequest(request, env);
			}

			if (pathname === HEALTH_PATH) {
				return handleHealthRequest(request, env);
			}

			return notFound();
		} catch (error) {
			console.error('Unhandled request error', error);

			return jsonResponse(
				{
					error: 'Internal server error',
					message: error instanceof Error ? error.message : 'Unknown error',
				},
				{
					status: 500,
				},
			);
		}
	},
	async scheduled(controller, env, context) {
		context.waitUntil(handleScheduledTypingHeartbeat(controller, env));
	},
};
