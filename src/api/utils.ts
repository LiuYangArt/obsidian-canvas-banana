/**
 * API 工具函数
 */

import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { HttpError } from './types';

/**
 * Type guard for HTTP errors from requestUrl
 */
export function isHttpError(error: unknown): error is HttpError {
    return typeof error === 'object' && error !== null && 'status' in error && typeof (error as HttpError).status === 'number';
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return String(error);
}

/**
 * Build endpoint from base URL and API version path.
 * Handles trailing slash compatibility and avoids duplicating the version
 * when base already ends with /v1 or /v1beta.
 */
export function buildVersionedApiEndpoint(baseUrl: string, version: 'v1' | 'v1beta', resourcePath: string): string {
    const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
    const normalizedResource = resourcePath.replace(/^\/+/, '');
    const versionPattern = new RegExp(`/${version}$`, 'i');
    const baseWithVersion = versionPattern.test(normalizedBase)
        ? normalizedBase
        : `${normalizedBase}/${version}`;
    return `${baseWithVersion}/${normalizedResource}`;
}

/**
 * Wraps requestUrl with a timeout mechanism using Promise.race
 * @param params Request parameters
 * @param timeoutMs Timeout in milliseconds
 * @returns Promise that rejects with timeout error if request takes too long
 */
export async function requestUrlWithTimeout(params: RequestUrlParam, timeoutMs: number): Promise<RequestUrlResponse> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
            reject(new Error(`TIMEOUT:${timeoutMs}`));
        }, timeoutMs);
    });

    return Promise.race([requestUrl(params), timeoutPromise]);
}
