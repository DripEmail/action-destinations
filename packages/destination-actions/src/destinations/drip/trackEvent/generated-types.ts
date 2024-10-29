// Generated file. DO NOT MODIFY IT BY HAND.

export interface Payload {
  /**
   * The city of the user who triggered the event
   */
  city?: string
  /**
   * The country of the user who triggered the event
   */
  country?: string
  /**
   * The email of the user who triggered the event
   */
  email: string
  /**
   * The name of the event you want to track
   */
  event: string
  /**
   * The IP address of the user who triggered the event
   */
  ip_address?: string
  /**
   * Additional information about the event
   */
  properties: {
    [k: string]: unknown
  }
  /**
   * The phone number of the user who triggered the event
   */
  sms?: string
  /**
   * The state of the user who triggered the event
   */
  state?: string
  /**
   * Tags for the subscriber
   */
  tags?: string
  /**
   * The timezone of the user who triggered the event
   */
  time_zone?: string
  /**
   * The ID of the user who triggered the event
   */
  userId?: string
}
