import { z } from 'zod/v4';
import { e } from '../../Endpoint';

const E = e.services([]);

export const getUsers = E.get('/users')
  .description('Get users')
  .output(z.object({ userId: z.string() }).array())
  .handle(({}) => []);

export const getFooUsers = E.get('/foo/users')
  .description('Get users')
  .output(z.object({ userId: z.string() }).array())
  .handle(({}) => []);
