/**
 * Module dependencies.
 */
var integration = require('../../../src/createIntegration')
var mapper = require('./mapper')
var fmt = require('util').format

/**
 * Expose `Drip`
 */
var Drip = module.exports = integration('Drip')
  .endpoint('https://api.getdrip.com/v2/')
  .ensure('settings.account')
  .ensure('settings.token')
  .ensure('message.email')
  .ensure(function (_, settings) {
    var projects = [
      'QsBFMv5VT8',
      'vqd4s1B4dR',
      'QKsV14k9Au',
      'fyKnQHJgmR',
      'U5ISWY97iv',
      '8HNVCx961K',
      'N28ghIbcxu',
      'VJoItsvt8u',
      'OMXAf05X0Z',
      'PtTnJLXNYZ'
    ]

    if (projects.indexOf(settings.projectId) !== -1) {
      return this.invalid('Drip has been disabled for this source. Please reach out to Segment Support (https://segment.com/help/contact).')
    }
  })
  .channels(['server'])

/**
 * Initialize.
 *
 * @api private
 */
Drip.prototype.initialize = function () {
}

/**
 * Identify.
 *
 * https://www.getdrip.com/docs/rest-api#subscribers
 *
 * @param {Identify} identify
 * @param {Function} fn
 * @api public
 */
Drip.prototype.identify = function (identify, fn) {
  const settings = this.settings
  const account = settings.account
  const subscribeUrl = fmt('%s/subscribers', account)
  const subscriber = mapper.identify(identify)
  const campaign = mapper.getCampaignId(identify, this.settings)

  this.post(subscribeUrl)
    .auth(settings.token)
    .type('json')
    .send({subscribers: [subscriber]})
    .end((err, res) => {
      if (res) {
        if (res.ok) {
          // subscribe to campaign if ID provided and initial subscription succeeded
          if (campaign.id) {
            const campaignUrl = fmt('%s/campaigns/%s/subscribers', account, campaign.id)
            this.post(campaignUrl)
              .auth(settings.token)
              .type('json')
              .send(campaign.data)
              .end((err, res) => {
                if (err) return fn(err)
                fn(null, res)
              })
            return
          }
          fn(null, res)
          return
        }

        const errors = res.body.errors || [{}]
        const msg = errors[0].message

        if (msg === 'Email is already subscribed') {
          fn(null, res)
          return
        }
      }
      fn(err)
    })
}

/**
 * Track.
 *
 * https://www.getdrip.com/docs/rest-api#events
 *
 * @param {Track} track
 * @param {Function} fn
 * @api public
 */
Drip.prototype.track = function (track, fn) {
  const account = this.settings.account
  const url = fmt('%s/events', account)
  const event = mapper.track(track)

  this.post(url)
    .auth(this.settings.token)
    .type('json')
    .send({events: [event]})
    .end(fn)
}

/**
 * Normalize the given `obj` keys.
 *
 * @param {Object} obj
 * @return {Object}
 * @api private
 */
Drip.prototype.normalize = function (obj) {
  var keys = Object.keys(obj)
  var ret = {}

  for (var i = 0; i < keys.length; ++i) {
    var key = keys[i].trim().replace(/[^a-z0-9_]/gi, '_')
    ret[key] = obj[keys[i]]
  }

  return ret
}
