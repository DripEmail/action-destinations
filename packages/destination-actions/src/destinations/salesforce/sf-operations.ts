import {
  IntegrationError,
  ModifiedResponse,
  RequestClient,
  RefreshAccessTokenResult,
  StatsContext
} from '@segment/actions-core'
import type { GenericPayload } from './sf-types'
import { mapObjectToShape } from './sf-object-to-shape'
import { buildCSVData, validateInstanceURL } from './sf-utils'
import { DynamicFieldResponse, createRequestClient } from '@segment/actions-core'
import { Settings } from './generated-types'
import { Logger } from '@segment/actions-core/destination-kit'

export const API_VERSION = 'v53.0'

/**
 * This error is triggered if the bulkHandler is ever triggered when the enable_batching setting is false.
 */
const throwBulkMismatchError = () => {
  const errorMsg = 'Bulk operation triggered where enable_batching is false.'
  throw new IntegrationError(errorMsg, errorMsg, 400)
}

const validateSOQLOperator = (operator: string | undefined): SOQLOperator => {
  if (operator !== undefined && operator !== 'OR' && operator !== 'AND') {
    throw new IntegrationError(`Invalid SOQL operator - ${operator}`, 'Invalid SOQL operator', 400)
  }

  // 'OR' is the default operator. Therefore, when we encounter 'undefined' we will return 'OR'.
  if (operator === undefined) {
    return 'OR'
  }

  return operator
}

export const generateSalesforceRequest = async (settings: Settings, request: RequestClient) => {
  if (!settings.auth_password || !settings.username) {
    return request
  }

  const { accessToken } = await authenticateWithPassword(
    settings.username,
    settings.auth_password,
    settings.security_token,
    settings.isSandbox
  )

  const passwordRequestClient = createRequestClient({
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  return passwordRequestClient
}

/**
 * Salesforce requires that the password provided for authentication be a concatenation of the
 * user password + the user security token.
 * For more info see: https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_username_password_flow.htm&type=5
 */
const constructPassword = (password: string, securityToken?: string): string => {
  let combined = ''
  if (password) {
    combined = password
  }

  if (securityToken) {
    combined = password + securityToken
  }

  return combined
}

export const authenticateWithPassword = async (
  username: string,
  auth_password: string,
  security_token?: string,
  isSandbox?: boolean
): Promise<RefreshAccessTokenResult> => {
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new IntegrationError('Missing Salesforce client ID or client secret', 'Missing Credentials', 400)
  }

  const newRequest = createRequestClient()

  const loginUrl = isSandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com'
  const password = constructPassword(auth_password, security_token)

  const res = await newRequest<SalesforceRefreshTokenResponse>(`${loginUrl}/services/oauth2/token`, {
    method: 'post',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      client_secret: clientSecret,
      username: username,
      password
    })
  })

  return { accessToken: res.data.access_token }
}

interface Records {
  Id?: string
}

interface LookupResponseData {
  Id?: string
  totalSize?: number
  records?: Records[]
}

interface CreateJobResponseData {
  id: string
}

interface SObjectsResponseData {
  sobjects: [
    {
      label: string
      name: string
      createable: boolean
      queryable: boolean
    }
  ]
}

interface SalesforceError {
  response: {
    data: [
      {
        message?: string
        errorCode?: string
      }
    ]
  }
}

interface SalesforceRefreshTokenResponse {
  access_token: string
}

type SOQLOperator = 'OR' | 'AND'

export default class Salesforce {
  instanceUrl: string
  request: RequestClient

  constructor(instanceUrl: string, request: RequestClient) {
    this.instanceUrl = validateInstanceURL(instanceUrl)

    // If the instanceUrl does not end with '/' append it to the string.
    // This ensures that all request urls are constructed properly
    this.instanceUrl = this.instanceUrl.concat(instanceUrl.slice(-1) === '/' ? '' : '/')
    this.request = request
  }

  createRecord = async (payload: GenericPayload, sobject: string) => {
    const json = this.buildJSONData(payload, sobject)

    return this.request(`${this.instanceUrl}services/data/${API_VERSION}/sobjects/${sobject}`, {
      method: 'post',
      json: json
    })
  }

  updateRecord = async (payload: GenericPayload, sobject: string) => {
    if (!payload.traits || Object.keys(payload.traits).length === 0) {
      throw new IntegrationError('Undefined Traits when using update operation', 'Undefined Traits', 400)
    }

    if (Object.keys(payload.traits).includes('Id') && payload.traits['Id']) {
      return await this.baseUpdate(payload.traits['Id'] as string, sobject, payload)
    }

    const soqlOperator: SOQLOperator = validateSOQLOperator(payload.recordMatcherOperator)
    const [recordId, err] = await this.lookupTraits(payload.traits, sobject, soqlOperator)

    if (err) {
      throw err
    }

    return await this.baseUpdate(recordId, sobject, payload)
  }

  upsertRecord = async (payload: GenericPayload, sobject: string) => {
    if (!payload.traits || Object.keys(payload.traits).length === 0) {
      throw new IntegrationError('Undefined Traits when using upsert operation', 'Undefined Traits', 400)
    }

    const soqlOperator: SOQLOperator = validateSOQLOperator(payload.recordMatcherOperator)
    const [recordId, err] = await this.lookupTraits(payload.traits, sobject, soqlOperator)

    if (err) {
      if (err.status === 404) {
        return await this.createRecord(payload, sobject)
      }
      throw err
    }
    return await this.baseUpdate(recordId, sobject, payload)
  }

  deleteRecord = async (payload: GenericPayload, sobject: string) => {
    if (!payload.traits || Object.keys(payload.traits).length === 0) {
      throw new IntegrationError('Undefined Traits when using delete operation', 'Undefined Traits', 400)
    }

    if (Object.keys(payload.traits).includes('Id') && payload.traits['Id']) {
      return await this.baseDelete(payload.traits['Id'] as string, sobject)
    }

    const soqlOperator: SOQLOperator = validateSOQLOperator(payload.recordMatcherOperator)
    const [recordId, err] = await this.lookupTraits(payload.traits, sobject, soqlOperator)

    if (err) {
      throw err
    }

    return await this.baseDelete(recordId, sobject)
  }

  bulkHandler = async (
    payloads: GenericPayload[],
    sobject: string,
    logging?: { shouldLog: boolean; logger?: Logger; stats?: StatsContext }
  ) => {
    if (!payloads[0].enable_batching) {
      throwBulkMismatchError()
    }

    if (payloads[0].operation === 'upsert') {
      return await this.bulkUpsert(payloads, sobject, logging)
    } else if (payloads[0].operation === 'update') {
      return await this.bulkUpdate(payloads, sobject, logging)
    } else if (payloads[0].operation === 'create') {
      return await this.bulkInsert(payloads, sobject, logging)
    }

    if (payloads[0].operation === 'delete') {
      throw new IntegrationError(
        `Unsupported operation: Bulk API does not support the delete operation`,
        'Unsupported operation',
        400
      )
    }
  }

  bulkHandlerWithSyncMode = async (
    payloads: GenericPayload[],
    sobject: string,
    syncMode: string | undefined,
    logging?: { shouldLog: boolean; logger?: Logger; stats?: StatsContext }
  ) => {
    if (!payloads[0].enable_batching) {
      throwBulkMismatchError()
    }

    if (syncMode === undefined) {
      throw new IntegrationError('syncMode is required', 'Undefined syncMode', 400)
    }

    if (syncMode === 'delete') {
      throw new IntegrationError(
        `Unsupported operation: Bulk API does not support the delete operation`,
        'Unsupported operation',
        400
      )
    }

    if (syncMode === 'upsert') {
      return await this.bulkUpsert(payloads, sobject, logging)
    } else if (syncMode === 'update') {
      return await this.bulkUpdate(payloads, sobject, logging)
    } else if (syncMode === 'add') {
      // Sync Mode does not have a "create" operation. We call it "add".
      // "add" will be transformed into "create" in the bulkInsert function.
      return await this.bulkInsert(payloads, sobject, logging)
    }
  }

  customObjectName = async (): Promise<DynamicFieldResponse> => {
    try {
      const result = await this.request<SObjectsResponseData>(
        `${this.instanceUrl}services/data/${API_VERSION}/sobjects`,
        {
          method: 'get',
          skipResponseCloning: true
        }
      )

      const fields = result.data.sobjects.filter((field) => {
        return field.createable === true
      })

      const choices = fields.map((field) => {
        return { value: field.name, label: field.label }
      })

      return {
        choices: choices,
        nextPage: '2'
      }
    } catch (err) {
      return {
        choices: [],
        nextPage: '',
        error: {
          message: (err as SalesforceError).response?.data[0]?.message ?? 'Unknown error',
          code: (err as SalesforceError).response?.data[0]?.errorCode ?? 'Unknown error'
        }
      }
    }
  }

  private bulkInsert = async (
    payloads: GenericPayload[],
    sobject: string,
    logging?: { shouldLog: boolean; logger?: Logger; stats?: StatsContext }
  ) => {
    // The idField is purposely passed as an empty string since the field is not required.
    return this.handleBulkJob(payloads, sobject, '', 'insert', logging)
  }

  private bulkUpsert = async (
    payloads: GenericPayload[],
    sobject: string,
    logging?: { shouldLog: boolean; logger?: Logger; stats?: StatsContext }
  ) => {
    if (
      !payloads[0].bulkUpsertExternalId ||
      !payloads[0].bulkUpsertExternalId.externalIdName ||
      !payloads[0].bulkUpsertExternalId.externalIdValue
    ) {
      throw new IntegrationError(
        'Undefined bulkUpsertExternalId.externalIdName or externalIdValue when using bulkUpsert operation',
        'Undefined bulkUpsertExternalId.externalIdName externalIdValue',
        400
      )
    }
    const externalIdFieldName = payloads[0].bulkUpsertExternalId.externalIdName
    return this.handleBulkJob(payloads, sobject, externalIdFieldName, 'upsert', logging)
  }

  private bulkUpdate = async (
    payloads: GenericPayload[],
    sobject: string,
    logging?: { shouldLog: boolean; logger?: Logger; stats?: StatsContext }
  ) => {
    if (!payloads[0].bulkUpdateRecordId) {
      throw new IntegrationError(
        'Undefined bulkUpdateRecordId when using bulkUpdate operation',
        'Undefined bulkUpdateRecordId',
        400
      )
    }

    return this.handleBulkJob(payloads, sobject, 'Id', 'update', logging)
  }

  private async handleBulkJob(
    payloads: GenericPayload[],
    sobject: string,
    idField: string,
    operation: string,
    logging?: { shouldLog: boolean; logger?: Logger; stats?: StatsContext }
  ): Promise<ModifiedResponse<unknown>> {
    // construct the CSV data to catch errors before creating a bulk job
    const csvStats = {
      shouldLog: logging?.shouldLog === true,
      numberOfColumns: 0,
      numberOfValuesInCSV: 0,
      numberOfNullsInCSV: 0
    }

    const csv = buildCSVData(payloads, idField, operation, csvStats)
    const jobId = await this.createBulkJob(sobject, idField, operation, logging)

    if (logging?.shouldLog === true) {
      const statsClient = logging?.stats?.statsClient
      const tags = logging?.stats?.tags
      tags?.push('jobId:' + jobId)

      statsClient?.incr('bulkCSV.payloadSize', payloads.length, tags)
      statsClient?.incr('bulkCSV.numberOfColumns', csvStats.numberOfColumns, tags)
      statsClient?.incr('bulkCSV.numberOfValuesInCSV', csvStats.numberOfValuesInCSV, tags)
      statsClient?.incr('bulkCSV.numberOfNullsInCSV', csvStats.numberOfNullsInCSV ?? 0, tags)
    }

    try {
      await this.uploadBulkCSV(jobId, csv, logging)
    } catch (err) {
      // always close the "bulk job" otherwise it will get
      // stuck in "pending".
      //
      // run in background to ensure this service has time to respond
      // with useful information before the connection closes.
      this.closeBulkJob(jobId, logging).catch((_) => {
        // ignore close error to avoid masking the root error
        const message = err.response?.data[0]?.message || 'Failed to parse message'
        const code = err.response?.data[0]?.errorCode || 'Failed to parse code'

        const statsClient = logging?.stats?.statsClient
        const tags = logging?.stats?.tags
        tags?.push('jobId:' + jobId)
        statsClient?.incr('bulkJobError.caughUploadError', 1, tags)
        logging?.logger?.error(`Failed to close bulk job: ${jobId}. Message: ${message}. Code: ${code}`)
      })
      throw err
    }

    try {
      return await this.closeBulkJob(jobId, logging)
    } catch (err) {
      const message = err.response?.data[0]?.message || 'Failed to parse message'
      const code = err.response?.data[0]?.errorCode || 'Failed to parse code'

      const statsClient = logging?.stats?.statsClient
      const tags = logging?.stats?.tags

      tags?.push('jobId:' + jobId)
      statsClient?.incr('bulkJobError', 1, tags)
      logging?.logger?.error(`Failed to close bulk job: ${jobId}. Message: ${message}. Code: ${code}`)

      throw err
    }
  }

  private createBulkJob = async (
    sobject: string,
    externalIdFieldName: string,
    operation: string,
    logging?: { shouldLog: boolean; logger?: Logger; stats?: StatsContext }
  ) => {
    const jsonData: { object: string; contentType: 'CSV'; operation: string; externalIdFieldName?: string } = {
      object: sobject,
      contentType: 'CSV',
      operation: operation
    }

    if (operation === 'update' || operation === 'upsert') {
      jsonData.externalIdFieldName = externalIdFieldName
    }

    const res = await this.request<CreateJobResponseData>(
      `${this.instanceUrl}services/data/${API_VERSION}/jobs/ingest`,
      {
        method: 'post',
        json: jsonData
      }
    )

    if (!res || !res.data || !res.data.id) {
      throw new IntegrationError('Failed to create bulk job', 'Failed to create bulk job', 500)
    }

    if (logging?.shouldLog) {
      logging.logger?.error(`Created bulk job: ${res.data.id} with data: ${JSON.stringify(jsonData)}`)

      const statsClient = logging.stats?.statsClient
      const tags = logging.stats?.tags

      tags?.push('jobId:' + res.data.id)
      statsClient?.incr('bulkJob.createBulkJob', 1, tags)
    }

    return res.data.id
  }

  private uploadBulkCSV = async (
    jobId: string,
    csv: string,
    logging?: { shouldLog: boolean; logger?: Logger; stats?: StatsContext }
  ) => {
    if (logging?.shouldLog) {
      logging.logger?.error(`Uploading CSV to job: ${jobId}\nCSV: ${csv}`)

      const statsClient = logging.stats?.statsClient
      const tags = logging.stats?.tags
      tags?.push('jobId:' + jobId)
      statsClient?.incr('bulkJob.uploadCSV', 1, tags)
    }

    return this.request(`${this.instanceUrl}services/data/${API_VERSION}/jobs/ingest/${jobId}/batches`, {
      method: 'put',
      headers: {
        'Content-Type': 'text/csv',
        Accept: 'application/json'
      },
      body: csv
    })
  }

  private closeBulkJob = async (
    jobId: string,
    logging?: { shouldLog: boolean; logger?: Logger; stats?: StatsContext }
  ) => {
    if (logging?.shouldLog) {
      logging.logger?.error(`Closing job: ${jobId}`)

      const statsClient = logging.stats?.statsClient
      const tags = logging.stats?.tags
      tags?.push('jobId:' + jobId)
      statsClient?.incr('bulkJob.closeBulkJob', 1, tags)
    }

    return this.request(`${this.instanceUrl}services/data/${API_VERSION}/jobs/ingest/${jobId}`, {
      method: 'PATCH',
      json: {
        state: 'UploadComplete'
      }
    })
  }

  private baseUpdate = async (recordId: string, sobject: string, payload: GenericPayload) => {
    const json = this.buildJSONData(payload, sobject)

    return this.request(`${this.instanceUrl}services/data/${API_VERSION}/sobjects/${sobject}/${recordId}`, {
      method: 'patch',
      json: json
    })
  }

  private baseDelete = async (recordId: string, sobject: string) => {
    return this.request(`${this.instanceUrl}services/data/${API_VERSION}/sobjects/${sobject}/${recordId}`, {
      method: 'delete'
    })
  }

  private buildJSONData = (payload: GenericPayload, sobject: string) => {
    let baseShape = {}

    if (!payload.customObjectName) {
      baseShape = mapObjectToShape(payload, sobject)
    }

    if (payload.customFields) {
      // custom field mappings take priority over base shape mappings.
      baseShape = { ...baseShape, ...payload.customFields }
    }

    return baseShape
  }

  // Salesforce SOQL spec requires any single quotes to be escaped.
  private escapeQuotes = (value: string) => value.replace(/'/g, "\\'")

  // Salesforce field names should have only characters in {a-z, A-Z, 0-9, _}.
  private removeInvalidChars = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, '')

  // Pre-formats trait values based on datatypes for correct SOQL syntax
  private typecast = (value: unknown) => {
    switch (typeof value) {
      case 'boolean':
        return value
      case 'number':
        return value
      case 'string':
        return `'${this.escapeQuotes(value)}'`
      default:
        throw new IntegrationError(
          'Unsupported datatype for record matcher traits - ' + typeof value,
          'Unsupported Type',
          400
        )
    }
  }

  private buildQuery = (traits: object, sobject: string, soqlOperator: SOQLOperator) => {
    let soql = `SELECT Id FROM ${sobject} WHERE `

    const entries = Object.entries(traits)
    let i = 0
    for (const [key, value] of entries) {
      let token = `${this.removeInvalidChars(key)} = ${this.typecast(value)}`

      if (i < entries.length - 1) {
        token += ' ' + soqlOperator + ' '
      }

      soql += token
      i += 1
    }

    return soql
  }

  private lookupTraits = async (
    traits: object,
    sobject: string,
    soqlOperator: SOQLOperator
  ): Promise<[string, IntegrationError | undefined]> => {
    const SOQLQuery = encodeURIComponent(this.buildQuery(traits, sobject, soqlOperator))

    const res = await this.request<LookupResponseData>(
      `${this.instanceUrl}services/data/${API_VERSION}/query/?q=${SOQLQuery}`,
      { method: 'GET' }
    )

    if (!res || !res.data || res.data.totalSize === undefined) {
      return ['', new IntegrationError('Response missing expected fields', 'Bad Response', 400)]
    }

    if (res.data.totalSize === 0) {
      return ['', new IntegrationError('No record found with given traits', 'Record Not Found', 404)]
    }

    if (res.data.totalSize > 1) {
      return ['', new IntegrationError('Multiple records returned with given traits', 'Multiple Records Found', 300)]
    }

    if (!res.data.records || !res.data.records[0] || !res.data.records[0].Id) {
      return ['', new IntegrationError('Response missing expected fields', 'Bad Response', 400)]
    }

    return [res.data.records[0].Id, undefined]
  }
}
