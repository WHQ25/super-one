'use strict'

const { applyAppVariant } = require('./app-variant')
const { applyBuildCode } = require('./build-code')

/**
 * `app.json` stays the base config and the release identity.
 *
 * Expo reads `app.json` first and hands it to this function as `config`, so
 * every static assertion in `scripts/assert-release-config.ts` keeps reading
 * the JSON directly. What lives here is what JSON cannot express: the
 * development variant's identity, and one build code fanned out to the two
 * differently named platform fields.
 */
module.exports = ({ config }) => applyAppVariant(applyBuildCode(config))
