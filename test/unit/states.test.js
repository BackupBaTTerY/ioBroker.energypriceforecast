'use strict';

const { expect } = require('chai');
const summary = require('../fixtures/summary_de.json');
const prices = require('../fixtures/prices_de.json');
const { STATES, CHANNELS, appliesTo, extractValues, resolveUnit, unitsFrom } = require('../../lib/states');

describe('state mapping', () => {
    it('reads every state from a real DE response', () => {
        const values = extractValues(summary, prices);
        expect(Object.keys(values)).to.have.members(Object.keys(STATES).filter(id => appliesTo(id, 'base')));
        expect(values['price.current']).to.equal(summary.price.current.value);
        expect(values['price.bestWindow.start']).to.equal(summary.price.best_window.start);
        expect(values['price.bestWindow.active']).to.equal(summary.price.best_window.is_active_now);
        expect(values['co2.current']).to.equal(summary.co2.current.value);
        expect(values['combined.scoreNow']).to.equal(summary.combined.score_now.score);
        expect(values['info.apiKeyState']).to.equal('missing');
        expect(values['quality.windowEvaluatedDays']).to.be.a('number');
    });

    it('writes each value with the declared type', () => {
        const values = extractValues(summary, prices);
        for (const [id, value] of Object.entries(values)) {
            if (value !== null) {
                expect(typeof value, id).to.equal(STATES[id].type);
            }
        }
    });

    it('names every channel and state in all eleven admin languages', () => {
        const languages = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];
        const named = [...Object.entries(STATES).map(([id, state]) => [id, state.name]), ...Object.entries(CHANNELS)];
        for (const [id, name] of named) {
            expect(name, id).to.be.an('object');
            expect(Object.keys(name), id).to.have.members(languages);
        }
    });

    it('reports 0 remaining minutes outside a window, not an empty number', () => {
        const values = extractValues(summary, prices);
        expect(summary.price.best_window.is_active_now).to.equal(false);
        expect(values['price.bestWindow.remainingMinutes']).to.equal(0);
        expect(values['co2.bestWindow.remainingMinutes']).to.equal(0);
    });

    it('slims the price series to start, end, value and source', () => {
        const series = JSON.parse(extractValues(summary, prices)['forecast.json']);
        expect(series).to.have.length(prices.entries.length);
        expect(Object.keys(series[0])).to.have.members(['start', 'end', 'value', 'source']);
    });

    it('marks where the published day-ahead prices end and the forecast begins', () => {
        const values = extractValues(summary, prices);
        const firstForecast = prices.entries.find(e => e.source === 'forecast');
        expect(values['forecast.lastDayAheadSlot']).to.equal(firstForecast.start);
        expect(values['forecast.end']).to.equal(prices.entries[prices.entries.length - 1].end);
    });

    it('leaves the price series alone when the prices request failed', () => {
        const values = extractValues(summary, undefined);
        expect(values).to.not.have.property('forecast.json');
        expect(values).to.not.have.property('forecast.end');
        expect(values['price.current']).to.equal(summary.price.current.value);
    });

    it('writes null for a missing window, so an old window does not linger', () => {
        const withoutWindow = { ...summary, co2: { ...summary.co2, best_window: null } };
        const values = extractValues(withoutWindow, prices);
        expect(values['co2.bestWindow.start']).to.equal(null);
        // With no window there is none running.
        expect(values['co2.bestWindow.active']).to.equal(false);
    });

    it('takes the price unit from the response, since it differs per market', () => {
        const units = unitsFrom({ price: { unit: 'DKK/kWh' }, co2: { unit: 'gCO2/kWh' } });
        expect(resolveUnit(STATES['price.current'].unit, units)).to.equal('DKK/kWh');
        expect(resolveUnit(STATES['co2.current'].unit, units)).to.equal('gCO2/kWh');
        expect(resolveUnit(STATES['price.bestWindow.remainingMinutes'].unit, units)).to.equal('min');
        expect(resolveUnit(STATES['info.plan'].unit, units)).to.equal(undefined);
    });

    it('has a channel for every state below the top level', () => {
        for (const id of Object.keys(STATES)) {
            const parent = id.split('.').slice(0, -1).join('.');
            if (parent !== 'info') {
                expect(CHANNELS, id).to.have.property(parent);
            }
        }
    });
});
