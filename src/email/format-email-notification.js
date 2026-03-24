const MAX_MESSAGE_LENGTH = 300;

export function formatEmailNotification(summary) {
	const lines = [
		'📧 新邮件提醒',
		`📝 主题: ${summary.subject}`,
		`👤 发件人: ${summary.from}`,
		`📬 收件人: ${summary.to}`, 
		'',
		'━━━━━━━━━━━━━━',
		summary.body,
		"━━━━━━━━━━━━━━"
	];

	if (summary.attachments.length > 0) {
		lines.push('');
		lines.push('Attachments:');
		lines.push(...summary.attachments.map((attachment) => formatAttachmentLine(attachment)));
	}

	const text = lines.filter((line) => line !== null).join('\n');
	const chunks = splitTextToChunks(text, MAX_MESSAGE_LENGTH);

	if (chunks.length === 1) {
		return chunks;
	}

	return chunks.map((chunk, index) => `${chunk}\n邮件分块 (${index + 1}/${chunks.length})`);
}

function formatAttachmentLine(attachment) {
	const sizeText = typeof attachment.size === 'number' ? `, ${attachment.size} bytes` : '';
	return `- ${attachment.filename} (${attachment.mimeType}${sizeText})`;
}

function splitTextToChunks(text, maxLength) {
	const chunks = [];
	let currentChunk = '';

	for (const paragraph of text.split('\n')) {
		const nextParagraph = currentChunk === '' ? paragraph : `\n${paragraph}`;

		if ((currentChunk + nextParagraph).length <= maxLength) {
			currentChunk += nextParagraph;
			continue;
		}

		if (currentChunk !== '') {
			chunks.push(currentChunk);
			currentChunk = '';
		}

		let remainingParagraph = paragraph;
		while (remainingParagraph.length > maxLength) {
			chunks.push(remainingParagraph.slice(0, maxLength));
			remainingParagraph = remainingParagraph.slice(maxLength);
		}

		currentChunk = remainingParagraph;
	}

	if (currentChunk !== '') {
		chunks.push(currentChunk);
	}

	return chunks.length > 0 ? chunks : [''];
}
