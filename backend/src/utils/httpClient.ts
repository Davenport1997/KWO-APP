/**
 * HTTP Client with built-in timeout and error handling
 * All external API calls should use this to ensure consistent timeout behavior
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

// Global timeout configuration
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const DEFAULT_CONNECT_TIMEOUT_MS = 10000; // 10 seconds for connection
const DEFAULT_READ_TIMEOUT_MS = 25000; // 25 seconds for reading response

/**
 * Create an axios instance with timeout configuration
 * @param baseURL - Optional base URL for the client
 * @param timeoutMs - Optional custom timeout (default: 30s)
 */
export function createSecureHttpClient(
  baseURL?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    // Connection timeout
    httpAgent: undefined,
    httpsAgent: undefined,
    // Add request/response interceptors for timeout handling
  });
}

/**
 * Default HTTP client instance (30s timeout)
 */
export const secureHttpClient = createSecureHttpClient();

/**
 * AI-specific client with 45s timeout for longer operations
 */
export const aiHttpClient = createSecureHttpClient(undefined, 45000);

/**
 * Payment verification client with 15s timeout
 */
export const paymentHttpClient = createSecureHttpClient(undefined, 15000);

/**
 * Add timeout interceptor to any axios instance
 * @param client - The axios client to add timeout handling to
 * @param maxRetries - Number of times to retry on timeout (default: 1)
 */
export function addTimeoutInterceptor(
  client: AxiosInstance,
  maxRetries: number = 1
): void {
  client.interceptors.response.use(
    response => response,
    async error => {
      const config = error.config as AxiosRequestConfig & { retryCount?: number };

      // Check if request timed out
      if (
        error.code === 'ECONNABORTED' ||
        error.message === 'timeout of 30000ms exceeded'
      ) {
        const retryCount = config.retryCount ?? 0;

        if (retryCount < maxRetries) {
          config.retryCount = retryCount + 1;
          console.warn(
            `Request timeout (attempt ${retryCount + 1}/${maxRetries}), retrying...`
          );
          return client(config);
        }

        // Max retries exceeded
        return Promise.reject(
          new Error(`Request timeout after ${retryCount} retries`)
        );
      }

      return Promise.reject(error);
    }
  );
}

/**
 * Fetch wrapper with timeout
 * Use this for non-axios fetch calls
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }

    throw error;
  }
}
