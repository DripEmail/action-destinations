import type { ActionDefinition } from '@segment/actions-core'
import type { Settings } from '../generated-types'
import type { Payload } from './generated-types'

const action: ActionDefinition<Settings, Payload> = {
  title: 'Test Action',
  description: '',
  fields: {},
  perform: (request, { settings, payload }) => {
    // Make your partner api request here!
    // return request('https://example.com', {
    //   method: 'post',
    //   json: data.payload
    // })
    return request(`${settings.endpoint}/2445926/subscribers`, {
      method: 'post',
      json: {
        subscribers: [
          {
            email: payload.email,
            initial_status: 'unsubscribed',
            source: 'yotpo_loyalty',
            internal_attributes: {
              yotpo_loyalty: { opt_in_status: 'true' }
            }
          }
        ]
      }
      // json: payload
    })
  }
}

export default action
