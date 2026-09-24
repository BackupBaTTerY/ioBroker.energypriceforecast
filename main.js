'use strict';

const utils = require('@iobroker/adapter-core');
const { ApiError, REJECTED_API_KEY_STATES, fetchSummary, fetchPrices } = require('./lib/api');
const { CHANNELS, STATES, extractValues, resolveUnit, unitsFrom } = require('./lib/states');
const { version } = require('./package.json');

const HORIZON_OPTIONS = [24, 48, 72, 120];
const DEFAULT_HORIZON_HOURS = 48;
const DEFAULT_WINDOW_HOURS = 4;
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 120;
const DEFAULT_INTERVAL_MINUTES = 30;
// Spread the installations over the minute instead of letting every one of
// them poll at the same second after a restart wave.
const MAX_JITTER_MS = 60_000;

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampInt(value, min, max, fallback) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, number));
}

class EnergyPriceForecast extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    constructor(options = {}) {
        super({ ...options, name: 'energypriceforecast' });
        this.pollTimer = null;
        /** unit last written per state */
        this.writtenUnits = {};
        this.lastApiKeyState = null;
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setState('info.connection', false, true);

        const market = String(this.config.market || '').toUpperCase();
        if (!market) {
            this.log.error('No market selected. Please choose one in the instance settings.');
            return;
        }
        const horizonHours = Number(this.config.horizonHours);
        this.settings = {
            market,
            horizonHours: HORIZON_OPTIONS.includes(horizonHours) ? horizonHours : DEFAULT_HORIZON_HOURS,
            windowHours: clampInt(this.config.windowHours, 1, 24, DEFAULT_WINDOW_HOURS),
            // Decrypted by js-controller, see encryptedNative in io-package.json.
            apiKey: String(this.config.apiKey || '').trim(),
            userAgent: `ioBroker.energypriceforecast/${version}`,
        };
        this.intervalMs =
            clampInt(
                this.config.intervalMinutes,
                MIN_INTERVAL_MINUTES,
                MAX_INTERVAL_MINUTES,
                DEFAULT_INTERVAL_MINUTES,
            ) * 60_000;

        await this.createObjects();
        await this.poll();
    }

    async createObjects() {
        for (const [id, name] of Object.entries(CHANNELS)) {
            await this.extendObjectAsync(id, { type: 'channel', common: { name }, native: {} });
        }
        for (const [id, state] of Object.entries(STATES)) {
            await this.extendObjectAsync(id, {
                type: 'state',
                common: {
                    name: state.name,
                    type: state.type,
                    role: state.role,
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
    }

    async poll() {
        this.pollTimer = null;
        try {
            const summary = await fetchSummary(this.settings);
            let prices;
            try {
                prices = await fetchPrices(this.settings);
            } catch (error) {
                // The summary alone still drives every automation state; the
                // series keeps its previous value until the next poll.
                this.log.warn(`Price series not updated: ${error.message}`);
            }
            await this.checkApiKey(summary.meta?.api_key_state);
            await this.writeValues(summary, prices);
            await this.setState('info.connection', true, true);
        } catch (error) {
            const reason = error instanceof ApiError ? error.message : `Unexpected error: ${error.stack || error}`;
            this.log.warn(`Update failed, keeping the last values: ${reason}`);
            await this.setState('info.connection', false, true);
        } finally {
            this.pollTimer = this.setTimeout(() => this.poll(), this.intervalMs + Math.random() * MAX_JITTER_MS);
        }
    }

    /**
     * A rejected key still gets public data, so the adapter keeps running -
     * but the user has to hear about it once, not on every poll.
     *
     * @param {string|undefined} apiKeyState
     */
    async checkApiKey(apiKeyState) {
        if (apiKeyState === this.lastApiKeyState) {
            return;
        }
        this.lastApiKeyState = apiKeyState;
        if (this.settings.apiKey && REJECTED_API_KEY_STATES.has(String(apiKeyState))) {
            this.log.error(
                `The API key was not accepted (state: ${apiKeyState}). Continuing with public access and its 48 h horizon.`,
            );
        } else if (apiKeyState === 'lookup_failed') {
            this.log.info('The API could not check the key this time and served public access instead.');
        }
    }

    /**
     * @param {any} summary
     * @param {any} [prices]
     */
    async writeValues(summary, prices) {
        const units = unitsFrom(summary);
        for (const [id, value] of Object.entries(extractValues(summary, prices))) {
            const unit = resolveUnit(STATES[id].unit, units);
            if (unit !== this.writtenUnits[id]) {
                await this.extendObjectAsync(id, { common: { unit } });
                this.writtenUnits[id] = unit;
            }
            await this.setStateChangedAsync(id, value, true);
        }
    }

    /**
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
            }
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    module.exports = options => new EnergyPriceForecast(options);
} else {
    new EnergyPriceForecast();
}
