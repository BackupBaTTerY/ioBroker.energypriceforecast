'use strict';

const path = require('path');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');

// Starts the adapter in a throwaway js-controller and lets it poll the real
// API once, so this needs network access.
tests.integration(path.join(__dirname, '..'), {
    // The dev build of js-controller requires a newer Node than the adapter
    // supports; test against the released one users actually run.
    controllerVersion: 'latest',

    defineAdditionalTests({ suite }) {
        suite('first poll against the live API', getHarness => {
            it('fills the price and CO2 states for DE', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.changeAdapterConfig('energypriceforecast', {
                    native: { market: 'DE', horizonHours: 48, windowHours: 4, intervalMinutes: 30 },
                });
                await harness.startAdapterAndWait();
                await new Promise(resolve => setTimeout(resolve, 15_000));

                const connection = await harness.states.getStateAsync('energypriceforecast.0.info.connection');
                expect(connection && connection.val).to.equal(true);
                const price = await harness.states.getStateAsync('energypriceforecast.0.price.current');
                expect(price && price.val).to.be.a('number');
                const series = await harness.states.getStateAsync('energypriceforecast.0.forecast.json');
                expect(JSON.parse(String(series && series.val))).to.be.an('array').that.is.not.empty;
                const unit = await harness.objects.getObjectAsync('energypriceforecast.0.price.current');
                expect(unit && unit.common.unit).to.equal('EUR/kWh');
            });
        });

        suite('household price estimate', getHarness => {
            it('shows the retail price and the grid operator for a German postal code', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.changeAdapterConfig('energypriceforecast', {
                    native: {
                        market: 'DE',
                        horizonHours: 48,
                        windowHours: 4,
                        intervalMinutes: 30,
                        priceBasis: 'estimate',
                        postalCode: '10115',
                    },
                });
                await harness.startAdapterAndWait();
                await new Promise(resolve => setTimeout(resolve, 15_000));

                const basis = await harness.states.getStateAsync('energypriceforecast.0.retail.basis');
                expect(basis && basis.val).to.equal('estimate');
                const gridArea = await harness.states.getStateAsync('energypriceforecast.0.retail.gridArea');
                expect(String(gridArea && gridArea.val)).to.match(/Berlin/);
                const gridFee = await harness.objects.getObjectAsync('energypriceforecast.0.retail.gridFee');
                expect(gridFee && gridFee.common.unit).to.equal('ct/kWh');
                // A household price includes fees and VAT on top of the
                // exchange price, so it cannot be negative or tiny.
                const price = await harness.states.getStateAsync('energypriceforecast.0.price.current');
                expect(price && price.val).to.be.above(0.1);
            });
        });
    },
});
