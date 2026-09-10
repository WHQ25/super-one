'use strict'

const { applyAppVariant } = require('./app-variant')

/**
 * `app.json` stays the base config and the release identity.
 *
 * Expo reads `app.json` first and hands it to this function as `config`, so
 * every static assertion in `scripts/assert-release-config.ts` keeps reading
 * the JSON directly. Only the development variant's identity lives here.
 */
module.exports = ({ config }) => applyAppVariant(config)
