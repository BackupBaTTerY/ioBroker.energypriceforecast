![Logo](admin/energypriceforecast.png)

# ioBroker.energypriceforecast

[![NPM version](https://img.shields.io/npm/v/iobroker.energypriceforecast.svg)](https://www.npmjs.com/package/iobroker.energypriceforecast)
[![Test and Release](https://github.com/BackupBaTTerY/ioBroker.energypriceforecast/workflows/Test%20and%20Release/badge.svg)](https://github.com/BackupBaTTerY/ioBroker.energypriceforecast/actions/workflows/test-and-release.yml)

## Energy Price Forecast EU adapter for ioBroker

Electricity price and CO2 forecast for 33 European bidding zones from
[energypriceforecast.eu](https://energypriceforecast.eu/).

Day-ahead prices are only published for the next day. This adapter continues
the series with a forecast of up to 120 hours, so an automation can already
decide today whether to charge the car tonight or wait for tomorrow's cheaper
hours. For every market it also reports the CO2 intensity of the grid.

What you get:

- the current price and CO2 intensity
- the cheapest and the greenest window of a length you choose (e.g. the 3 hours
  your dishwasher runs), with a flag that is `true` while the window is running
- a combined score that ranks the present hour against the coming 24 hours
- the whole price series in 15-minute slots as JSON, for charts and your own logic
- how well the forecast did in the last 30 days, so you can decide how much to trust it

All calculation happens on the server. The adapter polls, maps and writes states.

### Markets

AT, BE, BG, CH, CZ, DE, DK1, DK2, ES, FI, FR, GR, the seven Italian zones (NORD,
CNOR, CSUD, SUD, CALA, SICI, SARD), NL, NO1–NO5, PL, PT, RO, SE1–SE4, SK.

Prices are in the market's currency per kWh as the API reports it (EUR, DKK,
NOK, SEK, ...). They are wholesale prices: grid fees, taxes and your supplier's
margin are not included.

## Configuration

| Setting | Meaning |
|---|---|
| Market | Bidding zone. Germany and Luxembourg share one zone. |
| Forecast horizon | 24, 48, 72 or 120 hours. Public access serves up to 48 h. |
| Window length | Hours the cheapest and greenest window should cover, 1–24. |
| Update interval | 15–120 minutes, default 30. Prices change at most every 15 minutes. |
| API key | Optional. Only needed for a horizon beyond 48 h. Stored encrypted. |

## States

| State | Meaning |
|---|---|
| `price.current` | Price of the current slot |
| `price.currentSource` | `day_ahead` (published) or `forecast` |
| `price.bestWindow.start` / `.end` | Cheapest window in the horizon (ISO 8601, UTC) |
| `price.bestWindow.average` | Average price in that window |
| `price.bestWindow.active` | `true` while the cheapest window is running |
| `price.bestWindow.remainingMinutes` | Minutes left while it runs, otherwise `null` |
| `price.bestWindow.status` | `upcoming`, `active` or `passed` |
| `co2.current`, `co2.bestWindow.*` | The same for CO2 intensity (gCO2/kWh) |
| `combined.scoreNow` | Share of the coming 24 h that are worse on price and CO2 than now; 100 = now is the best time |
| `combined.bestWindow.start` / `.end` | Best compromise between cheap and clean |
| `forecast.json` | Price series as `[{start, end, value, source}]` in 15-minute slots |
| `forecast.lastDayAheadSlot` | Where published prices end and the forecast begins |
| `forecast.end` | End of the series |
| `quality.windowExactHitDays` / `.windowEvaluatedDays` | Days in the last 30 on which the forecast found exactly the cheapest window |
| `quality.windowWithinOneHourDays` | Days on which it was at most one hour off |
| `quality.windowMeanExtraCost` | What following the forecast window cost on average compared with the true cheapest one |
| `quality.hourlyMeanAbsError`, `quality.hourlyCorrelation` | Hourly accuracy over 30 days |
| `info.connection` | Last update succeeded |
| `info.apiKeyState` | `missing` for public access, `valid` with a key, otherwise why the key was refused |

Forecast values for a whole hour are repeated over its four quarters, never
interpolated: the model forecasts hours, and inventing values in between
would change what an automation sees.

## Example: start the dishwasher in the cheapest window

```js
on({ id: 'energypriceforecast.0.price.bestWindow.active', val: true }, () => {
    setState('shelly.0.dishwasher.Relay0.Switch', true);
});
```

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### 0.1.0 (2026-09-25)

- Initial release: price and CO2 forecast up to 120 h for 33 European markets,
  cheapest and greenest window, 15-minute price series

## License

MIT License

Copyright (c) 2026 BackupBaTTerY <StrompreisVorhersage@proton.me>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
