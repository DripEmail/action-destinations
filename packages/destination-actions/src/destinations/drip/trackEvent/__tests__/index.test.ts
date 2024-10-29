import nock from 'nock'
import { createTestEvent, createTestIntegration } from '@segment/actions-core'
import Destination from '../../index'

const testDestination = createTestIntegration(Destination)

describe('Drip.trackEvent', () => {
  it('should send event to Drip with correct parameters', async () => {
    const event = createTestEvent({
      event: 'Test Event',
      userId: 'user123',
      properties: {
        revenue: 19.99,
        currency: 'USD'
      }
    })

    nock('https://api.getdrip.com').post('/v2/1234567890/events').reply(200, {})

    const responses = await testDestination.testAction('trackEvent', {
      event,
      settings: {
        apiKey: 'test-api-key',
        endpoint: 'https://api.getdrip.com/v2'
      },
      mapping: {
        event: 'Test Event',
        userId: 'user123',
        properties: {
          revenue: 19.99,
          currency: 'USD'
        }
      }
    })

    expect(responses.length).toBe(1)
    expect(responses[0].status).toBe(200)
  })

  it('should handle API errors gracefully', async () => {
    const event = createTestEvent({
      event: 'Test Event',
      userId: 'user123',
      properties: {
        revenue: 19.99,
        currency: 'USD'
      }
    })

    nock('https://api.getdrip.com').post('/v2/1234567890/events').reply(500, { error: 'Internal Server Error' })

    await expect(
      testDestination.testAction('trackEvent', {
        event,
        settings: {
          apiKey: 'test-api-key',
          endpoint: 'https://api.getdrip.com/v2'
        },
        mapping: {
          event: 'Test Event',
          userId: 'user123',
          properties: {
            revenue: 19.99,
            currency: 'USD'
          }
        }
      })
    ).rejects.toThrow('Internal Server Error')
  })

  it('should require userId or anonymousId', async () => {
    const event = createTestEvent({
      event: 'Test Event',
      properties: {
        revenue: 19.99,
        currency: 'USD'
      }
    })

    await expect(
      testDestination.testAction('trackEvent', {
        event,
        settings: {
          apiKey: 'test-api-key',
          endpoint: 'https://api.getdrip.com/v2'
        },
        mapping: {
          event: 'Test Event',
          properties: {
            revenue: 19.99,
            currency: 'USD'
          }
        }
      })
    ).rejects.toThrow('Either userId or anonymousId must be defined')
  })
})
