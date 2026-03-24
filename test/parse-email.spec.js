import { describe, expect, it } from 'vitest';
import { parseRawEmail } from '../src/email/parse-email.js';

function createRawEmail({ subject = 'Parse Email Test', contentType = 'text/plain; charset="utf-8"', body }) {
	return `From: Alice <alice@example.com>
To: Bob <bob@example.com>
Subject: ${subject}
Message-ID: <${subject.toLowerCase().replace(/\s+/g, '-')}@example.com>
Date: Tue, 24 Mar 2026 10:00:00 +0800
MIME-Version: 1.0
Content-Type: ${contentType}

${body}`;
}

describe('parseRawEmail body cleanup', () => {
	it('removes links from plain text bodies', async () => {
		const rawEmail = createRawEmail({
			body: `Hello, visit https://example.com/path?q=1 now.
备用网址 www.example.org/docs 已删除。
Contact mailto:support@example.com for help.`,
		});

		const email = await parseRawEmail(rawEmail);

		expect(email.body).toBe(`Hello, visit now.
备用网址 已删除。
Contact for help.`);
	});

	it('removes links from HTML bodies', async () => {
		const rawEmail = createRawEmail({
			subject: 'HTML Body Test',
			contentType: 'text/html; charset="utf-8"',
			body: `<div>Hello</div><div>请查看 <a href="https://example.com/path?q=1">https://example.com/path?q=1</a></div><div>备用网址：www.example.org/docs</div><div>Thanks</div>`,
		});

		const email = await parseRawEmail(rawEmail);

		expect(email.body).toContain('Hello');
		expect(email.body).toContain('请查看');
		expect(email.body).toContain('Thanks');
		expect(email.body).not.toMatch(/\b(?:https?:\/\/|www\.|mailto:)/i);
	});
});
