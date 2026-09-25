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
 */

const CHANNELS = {
    price: { en: 'Electricity price', de: 'Strompreis' },
    'price.bestWindow': { en: 'Cheapest window', de: 'Günstigstes Zeitfenster' },
    co2: { en: 'CO2 intensity', de: 'CO2-Intensität' },
    'co2.bestWindow': { en: 'Greenest window', de: 'Grünstes Zeitfenster' },
    combined: { en: 'Price and CO2 combined', de: 'Preis und CO2 kombiniert' },
    'combined.bestWindow': { en: 'Best combined window', de: 'Bestes kombiniertes Zeitfenster' },
    forecast: { en: 'Price series', de: 'Preisreihe' },
    quality: { en: 'Forecast quality', de: 'Prognosequalität' },
    retail: { en: 'Household price basis', de: 'Grundlage des Endkundenpreises' },
};

/**
 * @param {string} en
 * @param {string} de
 * @param {'number'|'string'|'boolean'} type
 * @param {string} role
 * @param {(summary: any, prices: any, retail: any) => any} read
 * @param {string} [unit]
 */
function def(en, de, type, role, read, unit) {
    return { name: { en, de }, type, role, read, unit, fromPrices: false };
}

/**
 * Like def(), but read from the /prices response instead of the summary.
 *
 * @param en
 * @param de
 * @param type
 * @param role
 * @param read
 * @param unit
 */
function pricesDef(en, de, type, role, read, unit) {
    return { ...def(en, de, type, role, read, unit), fromPrices: true };
}

/**
 * The six states every best window has.
 *
 * @param {string} prefix
 * @param {string} label
 * @param {string} deLabel
 * @param {string} unitKind
 * @param {(summary: any) => any} pick
 */
function windowStates(prefix, label, deLabel, unitKind, pick) {
    return {
        [`${prefix}.start`]: def(`${label} start`, `${deLabel} Beginn`, 'string', 'date.start', s => pick(s)?.start),
        [`${prefix}.end`]: def(`${label} end`, `${deLabel} Ende`, 'string', 'date.end', s => pick(s)?.end),
        [`${prefix}.average`]: def(
            `${label} average`,
            `${deLabel} Mittelwert`,
            'number',
            'value',
            s => pick(s)?.average_value,
            unitKind,
        ),
        [`${prefix}.active`]: def(
            `${label} is active now`,
            `${deLabel} läuft gerade`,
            'boolean',
            'indicator',
            s => pick(s)?.is_active_now,
        ),
        [`${prefix}.remainingMinutes`]: def(
            `${label} minutes remaining`,
            `${deLabel} verbleibende Minuten`,
            'number',
            'value.interval',
            s => pick(s)?.remaining_minutes,
            'min',
        ),
        [`${prefix}.status`]: def(
            `${label} status (upcoming, active, passed)`,
            `${deLabel} Status (upcoming, active, passed)`,
            'string',
            'text',
            s => pick(s)?.status,
        ),
    };
}

const STATES = {
    'info.lastUpdate': def(
        'Last successful update',
        'Letzte erfolgreiche Aktualisierung',
        'string',
        'date',
        s => s.generated_at,
    ),
    'info.apiKeyState': def(
        'API key state (missing = public access)',
        'API-Key-Status (missing = öffentlicher Zugang)',
        'string',
        'text',
        s => s.meta?.api_key_state,
    ),
    'info.plan': def('Plan', 'Tarif', 'string', 'text', s => s.meta?.plan),
    'info.usedHorizonHours': def(
        'Forecast horizon served',
        'Gelieferter Prognosehorizont',
        'number',
        'value',
        s => s.meta?.used_horizon_hours,
        'h',
    ),

    'price.current': def('Current price', 'Aktueller Preis', 'number', 'value', s => s.price?.current?.value, 'price'),
    'price.currentSource': def(
        'Source of the current price (day_ahead or forecast)',
        'Quelle des aktuellen Preises (day_ahead oder forecast)',
        'string',
        'text',
        s => s.price?.current?.source,
    ),
    ...windowStates('price.bestWindow', 'Cheapest window', 'Günstigstes Fenster', 'price', s => s.price?.best_window),

    'co2.current': def(
        'Current CO2 intensity',
        'Aktuelle CO2-Intensität',
        'number',
        'value',
        s => s.co2?.current?.value,
        'co2',
    ),
    ...windowStates('co2.bestWindow', 'Greenest window', 'Grünstes Fenster', 'co2', s => s.co2?.best_window),

    'combined.scoreNow': def(
        'Share of the coming 24 h that are worse on price and CO2 than now (100 = now is best)',
        'Anteil der kommenden 24 h, die bei Preis und CO2 schlechter sind als jetzt (100 = jetzt ist am besten)',
        'number',
        'value',
        s => s.combined?.score_now?.score,
        '%',
    ),
    'combined.bestWindow.start': def(
        'Best combined window start',
        'Bestes kombiniertes Fenster Beginn',
        'string',
        'date.start',
        s => s.combined?.best_window_next_horizon?.start,
    ),
    'combined.bestWindow.end': def(
        'Best combined window end',
        'Bestes kombiniertes Fenster Ende',
        'string',
        'date.end',
        s => s.combined?.best_window_next_horizon?.end,
    ),

    'forecast.json': pricesDef(
        'Prices in 15-minute slots as JSON [{start, end, value, source}]',
        'Preise in 15-Minuten-Slots als JSON [{start, end, value, source}]',
        'string',
        'json',
        (_s, p) => JSON.stringify(slimEntries(p.entries)),
    ),
    'forecast.lastDayAheadSlot': pricesDef(
        'End of the published day-ahead prices; forecast after that',
        'Ende der veröffentlichten Day-Ahead-Preise; danach Prognose',
        'string',
        'date',
        (_s, p) => lastEnd(p.entries, 'day_ahead'),
    ),
    'forecast.end': pricesDef('End of the price series', 'Ende der Preisreihe', 'string', 'date.end', (_s, p) =>
        lastEnd(p.entries),
    ),

    'quality.windowEvaluatedDays': def(
        'Days evaluated for the cheapest-window hit rate',
        'Ausgewertete Tage für die Trefferquote des günstigsten Fensters',
        'number',
        'value',
        s => s.forecast_quality?.price_window?.evaluated_days,
    ),
    'quality.windowExactHitDays': def(
        'Days the forecast found exactly the cheapest window',
        'Tage, an denen die Prognose genau das günstigste Fenster traf',
        'number',
        'value',
        s => s.forecast_quality?.price_window?.exact_hit_days,
    ),
    'quality.windowWithinOneHourDays': def(
        'Days the forecast window was at most one hour off',
        'Tage, an denen das Prognosefenster höchstens eine Stunde danebenlag',
        'number',
        'value',
        s => s.forecast_quality?.price_window?.within_one_hour_days,
    ),
    'quality.windowMeanExtraCost': def(
        'Average extra cost of following the forecast window (wholesale basis)',
        'Mittlere Mehrkosten, wenn man dem Prognosefenster folgt (Börsenpreis-Basis)',
        'number',
        'value',
        s => s.forecast_quality?.price_window?.mean_extra_cost,
        'price',
    ),
    'quality.hourlyMeanAbsError': def(
        'Mean absolute hourly error over 30 days (wholesale basis)',
        'Mittlere absolute Stundenabweichung über 30 Tage (Börsenpreis-Basis)',
        'number',
        'value',
        s => s.hourly_accuracy?.mean_abs_error,
        'price',
    ),
    'quality.hourlyCorrelation': def(
        'Correlation of forecast and day-ahead price (1 = perfect)',
        'Korrelation von Prognose und Day-Ahead-Preis (1 = perfekt)',
        'number',
        'value',
        s => s.hourly_accuracy?.pearson_r,
    ),

    'retail.basis': def(
        'What the prices include: base (wholesale), estimate (API household price) or formula (own tariff)',
        'Was die Preise enthalten: base (Börse), estimate (Endkundenpreis der API) oder formula (eigener Tarif)',
        'string',
        'text',
        (_s, _p, r) => r.basis,
    ),
    'retail.gridArea': def('Grid area of the estimate', 'Netzgebiet der Schätzung', 'string', 'text', (s, _p, r) =>
        r.basis === 'estimate' ? s.assumptions?.netzgebiet_label : null,
    ),
    'retail.gridFee': def(
        'Grid fee in the estimate, without VAT',
        'Netzentgelt in der Schätzung, ohne MwSt.',
        'number',
        'value',
        (s, _p, r) => (r.basis === 'estimate' ? s.assumptions?.grid_fee_ct_kwh : null),
        'component',
    ),
    'retail.supplierMarkup': def(
        'Supplier markup in the estimate, without VAT',
        'Lieferantenaufschlag in der Schätzung, ohne MwSt.',
        'number',
        'value',
        (s, _p, r) => (r.basis === 'estimate' ? s.assumptions?.supplier_markup_ct_kwh : null),
        'component',
    ),
    'retail.leviesAndTaxes': def(
        'Levies and taxes in the estimate, without VAT',
        'Umlagen und Steuern in der Schätzung, ohne MwSt.',
        'number',
        'value',
        (s, _p, r) => (r.basis === 'estimate' ? s.assumptions?.levies_and_taxes_excl_vat_ct_kwh : null),
        'component',
    ),
    'retail.vatPercent': def(
        'VAT in the estimate',
        'MwSt. in der Schätzung',
        'number',
        'value',
        (s, _p, r) => (r.basis === 'estimate' ? s.assumptions?.vat_percent : null),
        '%',
    ),
    'retail.factor': def(
        'Factor of the own tariff formula',
        'Faktor der eigenen Tarifformel',
        'number',
        'value',
        (_s, _p, r) => (r.basis === 'formula' ? r.factor : null),
    ),
    'retail.surcharge': def(
        'Surcharge of the own tariff formula, including VAT',
        'Aufschlag der eigenen Tarifformel, inkl. MwSt.',
        'number',
        'value',
        (_s, _p, r) => (r.basis === 'formula' ? r.surcharge : null),
        'price',
    ),
};

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
 * `null` - "no active window" is a real answer and must overwrite the old
 * window. Without a prices response (that request failed) the price-series
 * states are left out entirely, so they keep their last good value.
 *
 * @param {any} summary /iobroker/summary response
 * @param {any} [prices] /iobroker/prices response, if that request succeeded
 * @param {{basis: string, factor?: number, surcharge?: number}} [retail] the price basis in use
 * @returns {Record<string, any>}
 */
function extractValues(summary, prices, retail = { basis: 'base' }) {
    const values = {};
    for (const [id, state] of Object.entries(STATES)) {
        if (state.fromPrices && !prices) {
            continue;
        }
        const value = state.read(summary, prices, retail);
        values[id] = value === undefined ? null : value;
    }
    return values;
}

module.exports = { CHANNELS, STATES, extractValues, resolveUnit, unitsFrom };
