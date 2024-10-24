import nock from 'nock'
// import { createTestEvent, createTestIntegration } from '@segment/actions-core'
import { createTestIntegration } from '@segment/actions-core'
import Definition from '../index'

const testDestination = createTestIntegration(Definition)

describe('Drip', () => {
  describe('testAuthentication', () => {
    it('should validate authentication inputs', async () => {
      nock('https://your.destination.endpoint').get('*').reply(200, {})

      // This should match your authentication.fields
      const authData = {
        apiKey: {
          label: 'API Key',
          description: 'API key for your Drip account. You can find this in your Drip account settings.',
          type: 'string',
          required: true
        }
      }

      await expect(testDestination.testAuthentication(authData)).resolves.not.toThrowError()
    })
  })
})
