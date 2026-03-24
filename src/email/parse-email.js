import { simpleParser } from 'mailparser';

const MAX_BODY_LENGTH = 1200;
const LINK_PATTERN = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)[^\s<>"']+/gi;

export async function parseRawEmail(rawEmail) {
	const email = await simpleParser(Buffer.from(rawEmail));

	return {
		subject: email.subject || '(无主题)',
		messageId: email.messageId || null,
		date: email.date || null,
		from: email.from?.value[0]?.address || '未知',
		to: email.to?.value[0]?.address || '未知',
		body: buildBodyText(email),
		attachments: email.attachments.map((attachment) => ({
			filename: attachment.filename || 'unnamed-attachment',
			mimeType: attachment.mimeType,
			disposition: attachment.disposition,
			contentId: attachment.contentId || null,
			size: getAttachmentSize(attachment),
		})),
	};
}

function buildBodyText(email) {
	const source = typeof email.text === 'string' && email.text.trim() !== '' ? email.text : stripHtml(email.html || '');
	const normalized = normalizeText(removeLinks(source));

	if (normalized === '') {
		return '(无正文)';
	}

	if (normalized.length <= MAX_BODY_LENGTH) {
		return normalized;
	}

	return `${normalized.slice(0, MAX_BODY_LENGTH).trimEnd()}...`;
}

function removeLinks(text) {
	return text.replace(LINK_PATTERN, '');
}

function normalizeText(text) {
	return text
		.replace(/\r\n/g, '\n')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function stripHtml(html) {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n')
		.replace(/<\/div>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"');
}

function getAttachmentSize(attachment) {
	if (typeof attachment.content === 'string') {
		return new TextEncoder().encode(attachment.content).byteLength;
	}

	if (attachment.content instanceof ArrayBuffer) {
		return attachment.content.byteLength;
	}

	if (ArrayBuffer.isView(attachment.content)) {
		return attachment.content.byteLength;
	}

	return null;
}
