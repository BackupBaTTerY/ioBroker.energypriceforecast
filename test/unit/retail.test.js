'use strict';

const { expect } = require('chai');
const summary = require('../fixtures/summary_de.json');
const prices = require('../fixtures/prices_de.json');
const retailSummary = require('../fixtures/summary_de_retail.json');
const { resolveRetailSettings, applyFormula } = require('../../lib/retail');
const { STATES, extractValues, resolveUnit, unitsFrom } = require('../../lib/states');

describe('retail settings', () => {
    it('defaults to the wholesale price', () => {
        expect(resolveRetailSettings('DE', {})).to.deep.equal({ basis: 'base' });
    });

    it('needs a 5-digit postal code for the German estimate', () => {
        expect(resolveRetailSettings('DE', { priceBasis: 'estimate', postalCode: '10115' })).to.deep.equal({
            basis: 'estimate',
            postalCode: '10115',
        });
        const missing = resolveRetailSettings('DE', { priceBasis: 'estimate', postalCode: '' });
        expect(missing.basis).to.equal('base');
        expect(missing.problem).to.match(/postal code/);
    });

    it('takes the estimate without a postal code where the API has a country-wide one', () => {
        expect(resolveRetailSettings('AT', { priceBasis: 'estimate' })).to.deep.equal({ basis: 'estimate' });
        expect(resolveRetailSettings('NO3', { priceBasis: 'estimate' })).to.deep.equal({ basis: 'estimate' });
        expect(resolveRetailSettings('NL', { priceBasis: 'estimate', postalCode: '1234 AB' }).postalCode).to.equal(
            '1234 AB',
        );
        expect(resolveRetailSettings('NL', { priceBasis: 'estimate', postalCode: '12' }).basis).to.equal('base');
    });

    it('falls back to wholesale where there is no estimate', () => {
        const result = resolveRetailSettings('FR', { priceBasis: 'estimate' });
        expect(result.basis).to.equal('base');
        expect(result.problem).to.match(/own tariff/);
    });

    it('accepts an own tariff in every market, but no factor that would reorder the hours', () => {
        expect(
            resolveRetailSettings('FR', { priceBasis: 'formula', retailFactor: 1.2, retailSurcharge: 0.15 }),
        ).to.deep.equal({
            basis: 'formula',
            factor: 1.2,
            surcharge: 0.15,
        });
        expect(
            resolveRetailSettings('DE', { priceBasis: 'formula', retailFactor: 0, retailSurcharge: 0 }).basis,
        ).to.equal('base');
        expect(
            resolveRetailSettings('DE', { priceBasis: 'formula', retailFactor: 1.19, retailSurcharge: 'x' }).basis,
        ).to.equal('base');
    });
});

describe('own tariff formula', () => {
    const factor = 1.19;
    const surcharge = 0.2;
    const converted = applyFormula(summary, prices, factor, surcharge);

    it('converts the current price, the window averages and the series', () => {
        const expected = Number((summary.price.current.value * factor + surcharge).toFixed(6));
        expect(converted.summary.price.current.value).to.equal(expected);
        expect(converted.summary.price.best_window.average_value).to.equal(
            Number((summary.price.best_window.average_value * factor + surcharge).toFixed(6)),
        );
        expect(converted.prices.entries[0].value).to.equal(
            Number((prices.entries[0].value * factor + surcharge).toFixed(6)),
        );
    });

    it('leaves the window where it was, and CO2 and quality untouched', () => {
        expect(converted.summary.price.best_window.start).to.equal(summary.price.best_window.start);
        expect(converted.summary.co2).to.equal(summary.co2);
        expect(converted.summary.forecast_quality).to.equal(summary.forecast_quality);
    });

    it('does not change the response it was given', () => {
        expect(summary.price.current.value).to.not.equal(converted.summary.price.current.value);
        expect(prices.entries[0].value).to.not.equal(converted.prices.entries[0].value);
    });

    it('works without a price series', () => {
        expect(applyFormula(summary, undefined, factor, surcharge).prices).to.equal(undefined);
    });

    it('writes the formula into the retail states', () => {
        const values = extractValues(converted.summary, converted.prices, { basis: 'formula', factor, surcharge });
        expect(values['retail.basis']).to.equal('formula');
        expect(values['retail.factor']).to.equal(factor);
        expect(values['retail.surcharge']).to.equal(surcharge);
        expect(values['retail.gridFee']).to.equal(null);
    });
});

describe('API household price estimate', () => {
    const values = extractValues(retailSummary, undefined, { basis: 'estimate', postalCode: '10115' });

    it('reads the grid area and the components the estimate is built from', () => {
        expect(values['retail.basis']).to.equal('estimate');
        expect(values['retail.gridArea']).to.equal(retailSummary.assumptions.netzgebiet_label);
        expect(values['retail.gridFee']).to.equal(retailSummary.assumptions.grid_fee_ct_kwh);
        expect(values['retail.vatPercent']).to.equal(retailSummary.assumptions.vat_percent);
        expect(values['retail.factor']).to.equal(null);
    });

    it('gives the components their own unit, ct/kWh, next to the price in EUR/kWh', () => {
        const units = unitsFrom(retailSummary);
        expect(resolveUnit(STATES['retail.gridFee'].unit, units)).to.equal('ct/kWh');
        expect(resolveUnit(STATES['price.current'].unit, units)).to.equal('EUR/kWh');
    });

    it('leaves the components empty on the wholesale basis', () => {
        const base = extractValues(summary, prices);
        expect(base['retail.basis']).to.equal('base');
        expect(base['retail.gridArea']).to.equal(null);
        expect(base['retail.gridFee']).to.equal(null);
    });
});
