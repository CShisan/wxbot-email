import { afterEach, describe, expect, it, vi } from 'vitest';
import { WechatClawbotClient } from '../src/clients/wechat-clawbot.js';

function createClient(fetchImplementation) {
	return new WechatClawbotClient(
		{
			wxClowbotBaseUrl: 'https://ilinkai.weixin.qq.com',
			wxClowbotChannelVersion: '1.0.2',
			wxClowbotToken: 'test-token',
			wxClowbotUserId: 'wx-user-id',
			wxClowbotContextToken: 'wx-context-token',
		},
		fetchImplementation,
	);
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
});

describe('WechatClawbotClient typing heartbeat', () => {
	it('fetches typing_ticket and sends a single typing heartbeat', async () => {
		const outboundFetch = vi.fn(async () => createJsonResponse({ ret: 0 }));
		outboundFetch.mockImplementationOnce(async () => createJsonResponse({ ret: 0, typing_ticket: 'typing-ticket-123' }));
		const client = createClient(outboundFetch);

		const heartbeat = await client.sendTypingHeartbeat();

		expect(heartbeat.typingTicket).toBe('typing-ticket-123');
		expect(outboundFetch).toHaveBeenCalledTimes(2);

		const [getConfigUrl, getConfigInit] = outboundFetch.mock.calls[0];
		expect(getConfigUrl).toBe('https://ilinkai.weixin.qq.com/ilink/bot/getconfig');
		expect(JSON.parse(getConfigInit.body)).toMatchObject({
			ilink_user_id: 'wx-user-id',
			context_token: 'wx-context-token',
			base_info: {
				channel_version: '1.0.2',
			},
		});

		const [sendTypingUrl, sendTypingInit] = outboundFetch.mock.calls[1];
		expect(sendTypingUrl).toBe('https://ilinkai.weixin.qq.com/ilink/bot/sendtyping');
		expect(JSON.parse(sendTypingInit.body)).toMatchObject({
			ilink_user_id: 'wx-user-id',
			typing_ticket: 'typing-ticket-123',
			status: 1,
			base_info: {
				channel_version: '1.0.2',
			},
		});
	});
});
