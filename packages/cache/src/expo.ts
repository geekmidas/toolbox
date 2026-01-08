import { addSeconds } from 'date-fns';
import * as SecureStore from 'expo-secure-store';
import { type Cache, getExpirationInSeconds } from './index';

export class ExpoSecureCache implements Cache {
	static getExpiryKey(key: string): string {
		return `${key}:expiresAt`;
	}

	async ttl(key: string): Promise<number> {
		const result = await SecureStore.getItemAsync(
			ExpoSecureCache.getExpiryKey(key),
		);
		if (!result) {
			return 0;
		}

		const secondsLeft = getExpirationInSeconds(result);

		return Math.max(secondsLeft, 0);
	}

	async get<T>(key: string): Promise<T | undefined> {
		const result = await SecureStore.getItemAsync(key);
		if (!result) {
			return undefined;
		}

		const expiresAt = await this.ttl(key);
		if (expiresAt === 0) {
			return undefined;
		}

		return JSON.parse(result) as T;
	}

	async set<T>(key: string, value: T, ttl: number = 600): Promise<void> {
		const expiresAt = addSeconds(new Date(), ttl).toISOString();
		await SecureStore.setItemAsync(key, JSON.stringify(value));
		await SecureStore.setItemAsync(
			ExpoSecureCache.getExpiryKey(key),
			expiresAt,
		);
	}

	async delete(key: string): Promise<void> {
		await SecureStore.deleteItemAsync(key);
		await SecureStore.deleteItemAsync(ExpoSecureCache.getExpiryKey(key));
	}
}
