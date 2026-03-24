const DEFAULT_WX_CLOWBOT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_WX_CLOWBOT_CHANNEL_VERSION = '1.0.2';
const CONFIG_STORE_BINDING = 'wxbot-email';
const API_AUTH_TOKEN_KEY = 'API_AUTH_TOKEN';

const WECHAT_CONFIG_FIELDS = {
	wxClowbotBaseUrl: {
		storageKey: 'WX_CLOWBOT_BASE_URL',
		defaultValue: DEFAULT_WX_CLOWBOT_BASE_URL,
		required: false,
	},
	wxClowbotChannelVersion: {
		storageKey: 'WX_CLOWBOT_CHANNEL_VERSION',
		defaultValue: DEFAULT_WX_CLOWBOT_CHANNEL_VERSION,
		required: false,
	},
	wxClowbotToken: {
		storageKey: 'WX_CLOWBOT_TOKEN',
		required: true,
	},
	wxClowbotUserId: {
		storageKey: 'WX_CLOWBOT_USER_ID',
		required: true,
	},
	wxClowbotContextToken: {
		storageKey: 'WX_CLOWBOT_CONTEXT_TOKEN',
		required: true,
	},
};

function hasKvNamespaceBinding(binding) {
	return Boolean(binding && typeof binding.get === 'function' && typeof binding.put === 'function');
}

function getConfigStoreOrThrow(env) {
	const configStore = env[CONFIG_STORE_BINDING];

	if (!hasKvNamespaceBinding(configStore)) {
		throw new Error(`Missing required KV binding: ${CONFIG_STORE_BINDING}`);
	}

	return configStore;
}

async function readKvString(configStore, key) {
	const value = await configStore.get(key);

	if (typeof value !== 'string' || value.trim() === '') {
		return null;
	}

	return value.trim();
}

async function getWechatConfigSnapshotFromStore(configStore) {
	const entries = await Promise.all(
		Object.entries(WECHAT_CONFIG_FIELDS).map(async ([fieldName, fieldDefinition]) => {
			const storedValue = await readKvString(configStore, fieldDefinition.storageKey);

			return [
				fieldName,
				storedValue ?? (Object.prototype.hasOwnProperty.call(fieldDefinition, 'defaultValue') ? fieldDefinition.defaultValue : null),
			];
		}),
	);

	return Object.fromEntries(entries);
}

export function getConfigFieldNames() {
	return Object.keys(WECHAT_CONFIG_FIELDS);
}

export async function getApiAuthToken(env) {
	const configStore = getConfigStoreOrThrow(env);
	return readKvString(configStore, API_AUTH_TOKEN_KEY);
}

export async function setApiAuthToken(env, token) {
	const normalizedToken = typeof token === 'string' ? token.trim() : '';

	if (!normalizedToken) {
		throw new Error('API auth token must be a non-empty string.');
	}

	const configStore = getConfigStoreOrThrow(env);
	await configStore.put(API_AUTH_TOKEN_KEY, normalizedToken);
}

export async function getWechatConfigSnapshot(env) {
	const configStore = getConfigStoreOrThrow(env);
	return getWechatConfigSnapshotFromStore(configStore);
}

export async function updateWechatConfig(env, patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
		throw new Error('Config update payload must be a JSON object.');
	}

	const requestedEntries = Object.entries(patch);

	if (requestedEntries.length === 0) {
		throw new Error(`Config update payload must include at least one of: ${getConfigFieldNames().join(', ')}`);
	}

	const configStore = getConfigStoreOrThrow(env);

	for (const [fieldName, rawValue] of requestedEntries) {
		const fieldDefinition = WECHAT_CONFIG_FIELDS[fieldName];

		if (!fieldDefinition) {
			throw new Error(`Unsupported config field: ${fieldName}`);
		}

		if (typeof rawValue !== 'string' || rawValue.trim() === '') {
			throw new Error(`Config field ${fieldName} must be a non-empty string.`);
		}

		await configStore.put(fieldDefinition.storageKey, rawValue.trim());
	}

	return getWechatConfigSnapshotFromStore(configStore);
}

export async function getAppConfig(env) {
	const configSnapshot = await getWechatConfigSnapshot(env);
	const missingRequiredFields = Object.entries(WECHAT_CONFIG_FIELDS)
		.filter(([fieldName, fieldDefinition]) => fieldDefinition.required && !configSnapshot[fieldName])
		.map(([, fieldDefinition]) => `${CONFIG_STORE_BINDING}.${fieldDefinition.storageKey}`);

	if (missingRequiredFields.length > 0) {
		throw new Error(`Missing required KV config: ${missingRequiredFields.join(', ')}`);
	}

	return configSnapshot;
}
