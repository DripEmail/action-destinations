/**
 * Module Dependencies
 */

const forOwn = require('lodash/forOwn')
const each = require('lodash/each')
const find = require('obj-case').find

/**
 * Map identify `msg`.
 *
 * @param {Facade} msg
 * @param {Object} settings
 * @return {Object}
 */

exports.identify = function (msg) {
  const topLevelAttributes = [
    'email',
    'tags',
    'new_email',
    'ip_address',
    'time_zone',
    'potential_lead',
    'prospect'
  ]
  const traits = msg.traits()
  let ret = {
    email: msg.email(),
    user_id: msg.userId(),
    custom_fields: removeRedundantFields(topLevelAttributes, normalize(traits))
  }
  // FIXME these are not spec'd traits but guess its tech debt/legacy now...
  // set top level attributes by looking up traits
  each(topLevelAttributes, function (field) {
    if (traits[field]) ret[field] = traits[field]
  })

  return ret
}

/**
 * Get campaign Id
 *
 * @param {Facade} msg
 * @param {Object} settings
 * @return {Object}
 */

exports.getCampaignId = function (msg, settings) {
  const topLevelAttributes = [
    'email',
    'tags',
    'time_zone',
    'prospect'
  ]
  const traits = msg.traits()
  let ret = {
    data: {
      subscribers: [
        {
          email: msg.email(),
          user_id: msg.userId(),
          custom_fields: removeRedundantFields(topLevelAttributes, normalize(traits))
        }
      ]
    }
  }
  // optionally subscribe this user to a specified default campaign ID from settings or dynamically via int options
  const campaignId = find(msg.options('Drip'), 'campaignId') || settings.campaignId
  if (campaignId) ret.id = campaignId

  return ret
}

/**
 * Map track `msg`.
 *
 * @param {Facade} msg
 * @param {Object} settings
 * @return {Object}
 */

exports.track = function (msg) {
  const topLevelAttributes = [
    'email',
    'revenue'
  ]
  let ret = {
    action: msg.event(),
    email: msg.email(),
    properties: {}
  }

  forOwn(msg.properties(), (value, key) => {
    let formattedKey = key.replace(/\s/g, '_')
    ret.properties[formattedKey] = value
  })

  if (msg.revenue()) ret.properties.value = Math.round(msg.revenue() * 100)
  ret.properties = removeRedundantFields(topLevelAttributes, ret.properties)

  return ret
}

/**
 * Normalize keys.
 *
 *    { 'some trait': true } => { some_trait: true }
 *
 * @param {Object} obj
 * @return {Object}
 */

function normalize (obj) {
  const keys = Object.keys(obj)
  return keys.reduce(function (ret, k) {
    let key = k.trim().replace(/[^a-z0-9_]/gi, '_')
    ret[key] = obj[k]
    return ret
  }, {})
}

/**
 * Remove redundant fields in custom fields if already being sent top level.
 *
 * @param {Array} fields
 * @param {Object} input
 * @return {Object}
 */

function removeRedundantFields (fields, input) {
  // `input` is already a clone
  each(fields, (semanticField) => { delete input[semanticField] })
  return input
}
