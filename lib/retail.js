'use strict';

/**
 * What the price states mean: the wholesale price, or what a household pays.
 *
 * - "base": the day-ahead price and its forecast, as the exchange publishes it.
 * - "estimate": the API's household price. It adds supplier markup, grid fee,
 *   levies and VAT from numbers the project keeps current - in Germany with
 *   the grid operator found from the postal code. Only for the markets in
 *   ESTIMATE_MARKETS.
 * - "formula": the user's own tariff, day-ahead x factor + surcharge, the same
 *   formula as the Home Assistant integration. Works in every market.
 *
 * A positive factor and a constant surcharge keep the order of the hours, so
 * the cheapest window stays where it was; only the amounts change. The
 * forecast-quality states stay on the wholesale basis in every mode, as the
 * API reports them.
 */

const BASES = ['base', 'estimate', 'formula'];

const ESTIMATE_MARKETS = new Set(['DE', 'NL', 'AT', 'DK1', 'DK2', 'NO1', 'NO2', 'NO3', 'NO4', 'NO5']);

// Above 0, or the order of the hours - and the cheapest window - would stop
// meaning anything. 10 leaves room for any VAT and then some.
const MIN_FACTOR = 0.01;
const MAX_FACTOR = 10;
// Per kWh including VAT, in the market's price unit. Wide enough for DKK, NOK
// and SEK, and negative for contracts with a discount on the exchange price.
const MIN_SURCHARGE = -100;
const MAX_SURCHARGE = 100;

// The API rounds its retail prices to six decimals too; without it a state
// would read 0.30000000000000004.
const DIGITS = 6;

/**
 * Checks the retail settings and turns them into what the adapter runs with.
 * A setting that cannot work falls back to the wholesale price with a
 * message, instead of leaving the instance without any price at all.
 *
 * @param {string} market e.g. "DE"
 * @param {Record<string, unknown>} config the instance's native config
 * @returns {{basis: string, postalCode?: string, factor?: number, surcharge?: number, problem?: string}}
 *   the settings to run with, and why they differ from the configured ones
 */
function resolveRetailSettings(market, config) {
    const basis = BASES.includes(String(config.priceBasis)) ? String(config.priceBasis) : 'base';

    if (basis === 'estimate') {
        if (!ESTIMATE_MARKETS.has(market)) {
            return {
                basis: 'base',
                problem: `There is no household price estimate for ${market} yet. Use "own tariff" instead; showing the wholesale price for now.`,
            };
        }
        const postalCode = String(config.postalCode || '').trim();
        if (market === 'DE') {
            // The grid fee depends on the grid operator, and the postal code
            // is how the API finds it. Without it there is no estimate.
            if (!/^\d{5}$/.test(postalCode)) {
                return {
                    basis: 'base',
                    problem:
                        'The household price estimate for Germany needs a 5-digit postal code. Showing the wholesale price for now.',
                };
            }
            return { basis, postalCode };
        }
        if (market === 'NL' && postalCode) {
            if (!/^\d{4}\s?[A-Za-z]{2}$/.test(postalCode)) {
                return {
                    basis: 'base',
                    problem: 'A Dutch postcode looks like "1234 AB". Showing the wholesale price for now.',
                };
            }
            return { basis, postalCode };
        }
        return { basis };
    }

    if (basis === 'formula') {
        const factor = Number(config.retailFactor);
        const surcharge = Number(config.retailSurcharge);
        if (!Number.isFinite(factor) || factor < MIN_FACTOR || factor > MAX_FACTOR) {
            return {
                basis: 'base',
                problem: `The factor must be between ${MIN_FACTOR} and ${MAX_FACTOR}. Showing the wholesale price for now.`,
            };
        }
        if (!Number.isFinite(surcharge) || surcharge < MIN_SURCHARGE || surcharge > MAX_SURCHARGE) {
            return {
                basis: 'base',
                problem: `The surcharge must be between ${MIN_SURCHARGE} and ${MAX_SURCHARGE}. Showing the wholesale price for now.`,
            };
        }
        return { basis, factor, surcharge };
    }

    return { basis: 'base' };
}

/**
 * @param {number} value wholesale price
 * @param {number} factor multiplier, e.g. 1.19 for 19 % VAT
 * @param {number} surcharge per kWh including VAT
 * @returns {number} the household price
 */
function formulaValue(value, factor, surcharge) {
    return Number((value * factor + surcharge).toFixed(DIGITS));
}

/**
 * @param {Record<string, any>|null|undefined} window a window block from the summary
 * @param {number} factor
 * @param {number} surcharge
 * @returns {Record<string, any>|null|undefined} the same window with its average converted
 */
function formulaWindow(window, factor, surcharge) {
    if (!window || typeof window.average_value !== 'number') {
        return window;
    }
    return { ...window, average_value: formulaValue(window.average_value, factor, surcharge) };
}

/**
 * The summary and price series with the user's formula applied to every
 * amount. Window positions, CO2 and the quality blocks stay as they are.
 *
 * @param {Record<string, any>} summary /iobroker/summary response on the wholesale basis
 * @param {Record<string, any>|undefined} prices /iobroker/prices response, if there is one
 * @param {number} factor
 * @param {number} surcharge
 * @returns {{summary: Record<string, any>, prices: Record<string, any>|undefined}} converted copies
 */
function applyFormula(summary, prices, factor, surcharge) {
    const price = summary.price || {};
    const current = price.current;
    const convertedSummary = {
        ...summary,
        price: {
            ...price,
            current:
                current && typeof current.value === 'number'
                    ? { ...current, value: formulaValue(current.value, factor, surcharge) }
                    : current,
            best_window: formulaWindow(price.best_window, factor, surcharge),
            next_full_window: formulaWindow(price.next_full_window, factor, surcharge),
            cheapest_window_next_horizon: formulaWindow(price.cheapest_window_next_horizon, factor, surcharge),
        },
    };
    const convertedPrices = prices && {
        ...prices,
        entries: (prices.entries || []).map(entry =>
            typeof entry.value === 'number' ? { ...entry, value: formulaValue(entry.value, factor, surcharge) } : entry,
        ),
    };
    return { summary: convertedSummary, prices: convertedPrices };
}

module.exports = { BASES, ESTIMATE_MARKETS, resolveRetailSettings, applyFormula, formulaValue };
