'use strict';

/**
 * The adapter's object tree and how each state is read from the API payload.
 *
 * Kept free of adapter calls so the mapping can be tested against a saved
 * API response (test/unit/states.test.js) without a running js-controller.
 *
 * `unit` is either a fixed string or "price"/"co2"/"component", which resolve
 * to the unit the API reports - the price unit depends on the market (EUR/kWh,
 * DKK/kWh, NOK/kWh, ...) and the retail components come in ct or øre per kWh,
 * so neither can be written into the definition.
 *
 * The names, in all eleven admin languages, live in names.json, keyed by id.
 */

const NAMES = require('./names.json');

const CHANNEL_IDS = [
    'price',
    'price.bestWindow',
    'co2',
    'co2.bestWindow',
    'combined',
    'combined.bestWindow',
    'forecast',
    'quality',
    'retail',
];

/**
 * @param {'number'|'string'|'boolean'} type
 * @param {string} role
 * @param {(summary: any, prices: any, retail: any) => any} read
 * @param {string} [unit]
 * @param {{fromPrices?: boolean, basis?: string}} [options] fromPrices: read
 *   from the /prices response instead of the summary; basis: the state only
 *   exists while that price basis is in use
 */
function def(type, role, read, unit, options = {}) {
    return { type, role, read, unit, fromPrices: !!options.fromPrices, basis: options.basis };
}

/**
 * The six states every best window has.
 *
 * @param {string} prefix
 * @param {string} unitKind
 * @param {(summary: any) => any} pick
 */
function windowStates(prefix, unitKind, pick) {
    return {
        [`${prefix}.start`]: def('string', 'date.start', s => pick(s)?.start),
        [`${prefix}.end`]: def('string', 'date.end', s => pick(s)?.end),
        [`${prefix}.average`]: def('number', 'value', s => pick(s)?.average_value, unitKind),
        [`${prefix}.active`]: def('boolean', 'indicator', s => pick(s)?.is_active_now ?? false),
        // The API reports no remaining time outside the window. 0 says the
        // same and keeps the state a number, as its type promises.
        [`${prefix}.remainingMinutes`]: def('number', 'value.interval', s => pick(s)?.remaining_minutes ?? 0, 'min'),
        [`${prefix}.status`]: def('string', 'text', s => pick(s)?.status),
    };
}

const DEFINITIONS = {
    'info.lastUpdate': def('string', 'date', s => s.generated_at),
    'info.apiKeyState': def('string', 'text', s => s.meta?.api_key_state),
    'info.plan': def('string', 'text', s => s.meta?.plan),
    'info.usedHorizonHours': def('number', 'value', s => s.meta?.used_horizon_hours, 'h'),

    'price.current': def('number', 'value', s => s.price?.current?.value, 'price'),
    'price.currentSource': def('string', 'text', s => s.price?.current?.source),
    ...windowStates('price.bestWindow', 'price', s => s.price?.best_window),

    'co2.current': def('number', 'value', s => s.co2?.current?.value, 'co2'),
    ...windowStates('co2.bestWindow', 'co2', s => s.co2?.best_window),

    'combined.scoreNow': def('number', 'value', s => s.combined?.score_now?.score, '%'),
    'combined.bestWindow.start': def('string', 'date.start', s => s.combined?.best_window_next_horizon?.start),
    'combined.bestWindow.end': def('string', 'date.end', s => s.combined?.best_window_next_horizon?.end),

    'forecast.json': def('string', 'json', (_s, p) => JSON.stringify(slimEntries(p.entries)), undefined, {
        fromPrices: true,
    }),
    'forecast.lastDayAheadSlot': def('string', 'date', (_s, p) => lastEnd(p.entries, 'day_ahead'), undefined, {
        fromPrices: true,
    }),
    'forecast.end': def('string', 'date.end', (_s, p) => lastEnd(p.entries), undefined, { fromPrices: true }),

    'quality.windowEvaluatedDays': def('number', 'value', s => s.forecast_quality?.price_window?.evaluated_days),
    'quality.windowExactHitDays': def('number', 'value', s => s.forecast_quality?.price_window?.exact_hit_days),
    'quality.windowWithinOneHourDays': def(
        'number',
        'value',
        s => s.forecast_quality?.price_window?.within_one_hour_days,
    ),
    'quality.windowMeanExtraCost': def(
        'number',
        'value',
        s => s.forecast_quality?.price_window?.mean_extra_cost,
        'price',
    ),
    'quality.hourlyMeanAbsError': def('number', 'value', s => s.hourly_accuracy?.mean_abs_error, 'price'),
    'quality.hourlyCorrelation': def('number', 'value', s => s.hourly_accuracy?.pearson_r),

    'retail.basis': def('string', 'text', (_s, _p, r) => r.basis),
    'retail.gridArea': def('string', 'text', s => s.assumptions?.netzgebiet_label, undefined, {
        basis: 'estimate',
    }),
    'retail.gridFee': def('number', 'value', s => s.assumptions?.grid_fee_ct_kwh, 'component', {
        basis: 'estimate',
    }),
    'retail.supplierMarkup': def('number', 'value', s => s.assumptions?.supplier_markup_ct_kwh, 'component', {
        basis: 'estimate',
    }),
    'retail.leviesAndTaxes': def('number', 'value', s => s.assumptions?.levies_and_taxes_excl_vat_ct_kwh, 'component', {
        basis: 'estimate',
    }),
    'retail.vatPercent': def('number', 'value', s => s.assumptions?.vat_percent, '%', { basis: 'estimate' }),
    'retail.factor': def('number', 'value', (_s, _p, r) => r.factor, undefined, { basis: 'formula' }),
    'retail.surcharge': def('number', 'value', (_s, _p, r) => r.surcharge, 'price', { basis: 'formula' }),
};

const STATES = Object.fromEntries(
    Object.entries(DEFINITIONS).map(([id, definition]) => [id, { ...definition, name: NAMES[id] }]),
);

const CHANNELS = Object.fromEntries(CHANNEL_IDS.map(id => [id, NAMES[id]]));

/**
 * Whether a state belongs to the object tree for this price basis. The
 * retail components exist only for the basis they describe, so an instance
 * on the wholesale price has no empty retail states.
 *
 * @param {string} id state id below the instance
 * @param {string} basis "base", "estimate" or "formula"
 */
function appliesTo(id, basis) {
    const state = STATES[id];
    return !state.basis || state.basis === basis;
}

/** @param {any[]} entries */
function slimEntries(entries) {
    return (entries || []).map(e => ({ start: e.start, end: e.end, value: e.value, source: e.source }));
}

/**
 * @param {any[]} entries
 * @param {string} [source] only consider entries from this source
 */
function lastEnd(entries, source) {
    const matching = (entries || []).filter(e => !source || e.source === source);
    return matching.length ? matching[matching.length - 1].end : null;
}

/**
 * @param {string|undefined} unitKind
 * @param {{price?: string, co2?: string, component?: string}} units
 */
function resolveUnit(unitKind, units) {
    if (unitKind === 'price' || unitKind === 'co2' || unitKind === 'component') {
        return units[unitKind];
    }
    return unitKind;
}

/** @param {any} summary */
function unitsFrom(summary) {
    return {
        price: summary.price?.unit,
        co2: summary.co2?.unit,
        component: summary.assumptions?.component_unit,
    };
}

/**
 * Every state's value from one poll. A field the summary leaves out becomes
 * `null` - "no window" is a real answer and must overwrite the old window.
 * Without a prices response (that request failed) the price-series states
 * are left out entirely, so they keep their last good value. States of
 * another price basis are left out too; they do not exist.
 *
 * @param {any} summary /iobroker/summary response
 * @param {any} [prices] /iobroker/prices response, if that request succeeded
 * @param {{basis: string, factor?: number, surcharge?: number}} [retail] the price basis in use
 * @returns {Record<string, any>}
 */
function extractValues(summary, prices, retail = { basis: 'base' }) {
    const values = {};
    for (const [id, state] of Object.entries(STATES)) {
        if ((state.fromPrices && !prices) || !appliesTo(id, retail.basis)) {
            continue;
        }
        const value = state.read(summary, prices, retail);
        values[id] = value === undefined ? null : value;
    }
    return values;
}

module.exports = { CHANNELS, STATES, NAMES, appliesTo, extractValues, resolveUnit, unitsFrom };
