import type { ActionDefinition } from '@segment/actions-core'
import type { Settings } from '../generated-types'
import type { Payload } from './generated-types'

const action: ActionDefinition<Settings, Payload> = {
  title: 'Track Event',
  description: 'Track an event',
  fields: {
    city: {
      type: 'string',
      required: false,
      description: 'The city of the user who triggered the event',
      label: 'City',
      default: {
        '@path': '$.context.location.city'
      }
    },
    country: {
      type: 'string',
      required: false,
      description: 'The country of the user who triggered the event',
      label: 'Country',
      default: {
        '@path': '$.context.location.country'
      }
    },
    email: {
      type: 'string',
      required: true,
      description: 'The email of the user who triggered the event',
      label: 'Email',
      default: {
        '@if': {
          exists: { '@path': '$.email' },
          then: { '@path': '$.email' },
          else: { '@path': '$.properties.email' }
        }
      }
    },
    event: {
      type: 'string',
      required: true,
      description: 'The name of the event you want to track',
      label: 'Event'
    },
    ip_address: {
      type: 'string',
      required: false,
      description: 'The IP address of the user who triggered the event',
      label: 'IP Address',
      default: {
        '@path': '$.context.ip'
      }
    },
    properties: {
      type: 'object',
      required: true,
      description: 'Additional information about the event',
      label: 'Properties',
      default: {
        '@path': '$.properties'
      }
    },
    sms: {
      type: 'string',
      required: false,
      description: 'The phone number of the user who triggered the event',
      label: 'SMS',
      default: {
        '@path': '$.context.traits.phone'
      }
    },
    state: {
      type: 'string',
      required: false,
      description: 'The state of the user who triggered the event',
      label: 'State',
      default: {
        '@path': '$.context.location.state'
      }
    },
    tags: {
      type: 'string', // Might need to figure out how to convert this to an array
      required: false,
      description: 'Tags for the subscriber',
      label: 'Tags',
      default: {
        '@path': '$.properties.tags' // Ensure this path is correct
      }
    },
    time_zone: {
      type: 'string',
      required: false,
      description: 'The timezone of the user who triggered the event',
      label: 'Timezone',
      default: {
        '@path': '$.context.timezone'
      }
    },
    userId: {
      type: 'string',
      required: false,
      description: 'The ID of the user who triggered the event',
      label: 'User ID',
      default: {
        '@path': '$.userId'
      }
    }
  },
  perform: (request, { settings, payload }) => {
    // Ensure properties is an object
    const formattedPayload = {
      ...payload,
      properties: typeof payload.properties === 'object' ? payload.properties : {}
    }

    // Validate that either userId or anonymousId is present
    if (!payload.userId && !payload.anonymousId) {
      throw new Error('Either userId or anonymousId must be defined')
    }

    return request(`${settings.endpoint}/events`, {
      method: 'post',
      json: formattedPayload
    })
  }
}

export default action
