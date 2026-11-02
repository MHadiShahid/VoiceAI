import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { createMemoryRepositories } from './memoryRepositories.js';

export const WEBHOOK_SECRET = 'test-secret';

export function buildTestApp({ repositories = createMemoryRepositories(), now } = {}) {
  const app = createApp({
    repositories,
    logger: createLogger({ level: 'silent' }),
    config: {
      clinicTimezone: 'America/New_York',
      vapiWebhookSecret: WEBHOOK_SECRET,
      isProduction: false,
      publicPhoneNumber: '+15555550100',
    },
    now,
  });
  return { app, repositories };
}

export const validPatient = () => ({
  first_name: 'Jane',
  last_name: 'Doe',
  date_of_birth: '04/12/1988',
  sex: 'Female',
  phone_number: '(415) 555-0134',
  email: 'Jane.Doe@Example.com',
  address_line_1: '742 Evergreen Terrace',
  address_line_2: 'Apt 3B',
  city: 'San Francisco',
  state: 'California',
  zip_code: '94110',
});
