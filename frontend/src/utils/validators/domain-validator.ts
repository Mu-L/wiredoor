import type { ObjectSchema } from 'joi'
import Joi from './joi-validator'

export interface DomainForm {
  id?: number
  domain: string
  ssl?: string
  skipValidation?: boolean
}

export interface Domain extends DomainForm {
  created_at?: string
  updated_at?: string
}

export const domainValidator: ObjectSchema<DomainForm> = Joi.object({
  domain: Joi.string().domain().required(),
  ssl: Joi.string().when('validation', {
    is: false,
    then: Joi.valid('self-signed').allow(null).optional(),
    otherwise: Joi.valid('self-signed', 'certbot').allow(null).optional(),
  }),
  skipValidation: Joi.boolean().optional(),
})
