'use strict';

/**
 * Thin client for the two ioBroker endpoints of api.energypriceforecast.eu.
 *
 * All the arithmetic (cheapest window, CO2 window, combined score, forecast
 * quality) happens on the server. The adapter only fetches and maps, so a
 * fix in the API reaches every installation without an adapter release.
 */

const BASE_URL = 'https://api.energypriceforecast.eu/api/v1/iobroker';
const REQUEST_TIMEOUT_MS = 20_000;

// The API never answers 401/403 for a bad key. It responds with 200, serves
// the public horizon and reports the outcome in meta.api_key_state. Only
// these states mean the key itself was examined and refused.
const REJECTED_API_KEY_STATES = new Set(['invalid', 'invalid_format', 'revoked', 'inactive', 'expired']);

class ApiError extends Error {
    /**
     * @param {string} message
     * @param {number} [status] HTTP status, if the server answered at all
     */
    constructor(message, status) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

/**
 * @param {string} path endpoint below BASE_URL, e.g. "summary"
 * @param {Record<string, string|number>} params query parameters
 * @param {{apiKey?: string, userAgent: string}} options
 * @returns {Promise<any>}
 */
async function getJson(path, params, options) {
    const url = new URL(`${BASE_URL}/${path}`);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
    }
    const headers = { Accept: 'application/json', 'User-Agent': options.userAgent };
    if (options.apiKey) {
        headers.Authorization = `Bearer ${options.apiKey}`;
    }

    let response;
    try {
        response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
        throw new ApiError(`Request to ${path} failed: ${error.message}`);
    }

    let body;
    try {
        body = await response.json();
    } catch {
        throw new ApiError(`${path} answered HTTP ${response.status} without JSON`, response.status);
    }
    if (!response.ok) {
        // Error bodies carry a human-readable "detail", e.g. the list of
        // supported markets for an unknown country.
        const detail = body && typeof body.detail === 'string' ? `: ${body.detail}` : '';
        throw new ApiError(`${path} answered HTTP ${response.status}${detail}`, response.status);
    }
    return body;
}

/**
 * Asks for the API's household price when that is the configured basis. The
 * user's own formula is applied locally to the wholesale price instead.
 *
 * @param {{retail: {basis: string, postalCode?: string}}} config
 * @returns {Record<string, string>} extra query parameters
 */
function retailParams(config) {
    if (config.retail.basis !== 'estimate') {
        return {};
    }
    const params = { price_mode: 'retail' };
    if (config.retail.postalCode) {
        params.plz = config.retail.postalCode;
    }
    return params;
}

/**
 * @param {{market: string, horizonHours: number, windowHours: number, retail: {basis: string, postalCode?: string}, apiKey?: string, userAgent: string}} config
 */
function fetchSummary(config) {
    return getJson(
        'summary',
        {
            country: config.market.toLowerCase(),
            hours: config.horizonHours,
            // Search the best windows over the whole horizon, as the Home
            // Assistant integration does, not just over the default 24 h.
            summary_hours: config.horizonHours,
            window_hours: config.windowHours,
            ...retailParams(config),
        },
        config,
    );
}

/**
 * @param {{market: string, horizonHours: number, retail: {basis: string, postalCode?: string}, apiKey?: string, userAgent: string}} config
 */
function fetchPrices(config) {
    return getJson(
        'prices',
        {
            country: config.market.toLowerCase(),
            hours: config.horizonHours,
            mode: 'mixed',
            // 15-minute slots throughout: day-ahead natively, the hourly
            // forecast repeated over its four quarters (never interpolated).
            resolution: '15m',
            ...retailParams(config),
        },
        config,
    );
}

module.exports = { ApiError, REJECTED_API_KEY_STATES, fetchSummary, fetchPrices };
