'use strict';

const { expect } = require('chai');
const config = require('../../admin/jsonConfig.json');
const fixture = require('../fixtures/summary_de.json');
const { extractValues, unitsFrom, resolveUnit } = require('../../lib/states');
const { resolveRetailSettings } = require('../../lib/retail');

describe('Great Britain', () => {
    it('offers GB in the native market selector', () => {
        expect(config.items.market.options.some(option => option.value === 'GB')).to.equal(true);
    });

    it('preserves GBP/kWh values, including zero and negative prices', () => {
        for (const value of [0, -0.02, 0.179062]) {
            const summary = {
                ...fixture,
                country: 'GB',
                price: {
                    ...fixture.price,
                    unit: 'GBP/kWh',
                    current: { ...fixture.price.current, value, unit: 'GBP/kWh' },
                },
            };
            expect(extractValues(summary)['price.current']).to.equal(value);
            expect(resolveUnit('price', unitsFrom(summary))).to.equal('GBP/kWh');
        }
    });

    it('does not invent a household-price estimate for GB', () => {
        const settings = resolveRetailSettings('GB', { priceBasis: 'estimate' });
        expect(settings.basis).to.equal('base');
        expect(settings.problem).to.match(/no household price estimate for GB/);
    });
});
