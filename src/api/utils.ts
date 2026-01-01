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
