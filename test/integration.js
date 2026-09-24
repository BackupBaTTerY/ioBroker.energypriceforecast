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
    },
});
