import type { DestinationDefinition } from '@segment/actions-core'
import type { Settings } from './generated-types'

import testAction from './testAction'

import trackEvent from './trackEvent'

const destination: DestinationDefinition<Settings> = {
  name: 'Drip',
  slug: 'drip',
  mode: 'cloud',

  authentication: {
    scheme: 'custom',
    fields: {
      apiKey: {
        label: 'API Key',
        description: 'API key for your Drip account. You can find this in your Drip account settings.',
        type: 'string',
        required: true
      },
      endpoint: {
        label: 'API Endpoint',
        description: 'For Drip API, the endpoint is https://api.getdrip.com/v2/.',
        type: 'string',
        required: true,
        default: 'https://api.getdrip.com/v2'
      }
    }
    // testAuthentication: (request) => {
    //   // Return a request that tests/validates the user's credentials.
    //   // If you do not have a way to validate the authentication fields safely,
    //   // you can remove the `testAuthentication` function, though discouraged.
    // }
    // return request(`${API_URL}/accounts/`, {
    //   method: 'get'
    // })
  },

  extendRequest({ settings }) {
    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${settings.apiKey}`
      }
    }
  },

  // onDelete: async (request, { settings, payload }) => {
  //   // Return a request that performs a GDPR delete for the provided Segment userId or anonymousId
  //   // provided in the payload. If your destination does not support GDPR deletion you should not
  //   // implement this function and should remove it completely.
  // },

  actions: {
    testAction,
    trackEvent
  }
}

export default destination
