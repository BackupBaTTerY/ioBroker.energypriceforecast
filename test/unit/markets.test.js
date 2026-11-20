'use strict';

const { expect } = require('chai');
const config = require('../../admin/jsonConfig.json');

// The markets the ioBroker endpoints accept, as the API lists them in its
// "Unsupported country" error. Keep this in step with the API: a market the
// selector lacks cannot be chosen at all.
const API_MARKETS = [
    'AT',
    'BE',
    'BG',
    'CH',
    'CZ',
    'DE',
    'DK1',
    'DK2',
    'ES',
    'FI',
    'FR',
    'GB',
    'GR',
    'HR',
    'HU',
    'ITN',
    'IT_CALA',
    'IT_CNOR',
    'IT_CSUD',
    'IT_SARD',
    'IT_SICI',
    'IT_SUD',
    'NL',
    'NO1',
    'NO2',
    'NO3',
    'NO4',
    'NO5',
    'PL',
    'PT',
    'RO',
    'SE1',
    'SE2',
    'SE3',
    'SE4',
    'SI',
    'SK',
];

describe('market selector', () => {
    const values = config.items.market.options.map(option => option.value);

    it('offers exactly the markets the API serves', () => {
        expect(values).to.have.members(API_MARKETS);
        expect(values).to.have.length(API_MARKETS.length);
    });

    it('offers Hungary, Slovenia and Croatia', () => {
        expect(values).to.include.members(['HU', 'SI', 'HR']);
    });

    it('lists the markets in alphabetical order of their codes', () => {
        expect(values).to.deep.equal([...values].sort());
    });
});
