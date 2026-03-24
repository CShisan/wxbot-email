import { randomWechatUin } from '../utils/crypto.js';

const SEND_MESSAGE_ENDPOINT = 'ilink/bot/sendmessage';
const GET_CONFIG_ENDPOINT = 'ilink/bot/getconfig';
const SEND_TYPING_ENDPOINT = 'ilink/bot/sendtyping';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;
const TYPING_STATUS = {
	TYPING: 1,
	CANCEL: 2,
};

function buildApiUrl(baseUrl, endpoint) {
	const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	return new URL(endpoint, normalizedBaseUrl).toString();
}

function buildHeaders(token, bodyText) {
	const headers = new Headers({
		'Content-Type': 'application/json',
		AuthorizationType: 'ilink_bot_token',
		'X-WECHAT-UIN': randomWechatUin(),
		'Content-Length': String(new TextEncoder().encode(bodyText).byteLength),
	});

	headers.set('Authorization', `Bearer ${token}`);
	return headers;
}

function normalizeRequiredString(fieldName, value) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${fieldName} must be a non-empty string`);
	}

	return value.trim();
}

async function parseJsonResponse(response) {
	const text = await response.text();

	if (text === '') {
		return null;
	}

	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export class WechatClawbotClient {
	constructor(config, fetchImplementation) {
		this.config = config;
		this.fetchImplementation = fetchImplementation ?? globalThis.fetch.bind(globalThis);
	}

	async sendTextMessages(messages) {
		const results = [];

		for (const message of messages) {
			const clientId = `email-${crypto.randomUUID()}`;
			const response = await this.#postJson(
				SEND_MESSAGE_ENDPOINT,
				{
					msg: {
						from_user_id: '',
						to_user_id: this.config.wxClowbotUserId,
						client_id: clientId,
						message_type: 2,
						message_state: 2,
						context_token: this.config.wxClowbotContextToken,
						item_list: [
							{
								type: 1,
								text_item: {
									text: message,
								},
							},
						],
					},
				},
				DEFAULT_TIMEOUT_MS,
			);

			results.push({
				clientId,
				response,
			});
		}

		return results;
	}

	async sendTypingHeartbeat(options = {}) {
		const ilinkUserId = normalizeRequiredString('ilinkUserId', options.ilinkUserId ?? this.config.wxClowbotUserId);
		const contextToken = normalizeRequiredString(
			'contextToken',
			options.contextToken ?? this.config.wxClowbotContextToken,
		);
		const typingTicketResponse = await this.#postJson(
			GET_CONFIG_ENDPOINT,
			{
				ilink_user_id: ilinkUserId,
				context_token: contextToken,
			},
			options.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
		);
		const typingTicket = typingTicketResponse?.typing_ticket;

		if (typingTicketResponse?.ret != null && typingTicketResponse.ret !== 0) {
			throw new Error(
				`Wechat clawbot getconfig failed: ${typingTicketResponse.errmsg ?? `ret=${typingTicketResponse.ret}`}`,
			);
		}

		if (typeof typingTicket !== 'string' || typingTicket.trim() === '') {
			throw new Error('Wechat clawbot getconfig response missing typing_ticket');
		}

		const status = options.status ?? TYPING_STATUS.TYPING;
		const response = await this.#postJson(
			SEND_TYPING_ENDPOINT,
			{
				ilink_user_id: ilinkUserId,
				typing_ticket: typingTicket.trim(),
				status,
			},
			options.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
		);

		if (response?.ret != null && response.ret !== 0) {
			throw new Error(`Wechat clawbot sendtyping failed: ${response.errmsg ?? `ret=${response.ret}`}`);
		}

		return {
			typingTicket: typingTicket.trim(),
			response,
		};
	}

	async #postJson(endpoint, payload, timeoutMs) {
		const body = JSON.stringify({
			...payload,
			base_info: {
				channel_version: this.config.wxClowbotChannelVersion,
			},
		});

		const controller = new AbortController();
		const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await this.fetchImplementation(buildApiUrl(this.config.wxClowbotBaseUrl, endpoint), {
				method: 'POST',
				headers: buildHeaders(this.config.wxClowbotToken, body),
				body,
				signal: controller.signal,
			});
			const parsedResponse = await parseJsonResponse(response);

			if (!response.ok) {
				throw new Error(
					`Wechat clawbot request failed with HTTP ${response.status}: ${JSON.stringify(parsedResponse)}`,
				);
			}

			return parsedResponse;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Wechat clawbot request timed out');
			}

			throw error;
		} finally {
			clearTimeout(timeoutHandle);
		}
	}
}
