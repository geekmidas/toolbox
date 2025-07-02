import { KyselyFactory } from './KyselyFactory';

interface Database {
  users: {
    id: number;
    name: string;
    email: string;
    createdAt: Date;
  };
  posts: {
    id: number;
    title: string;
    content: string;
    userId: number;
    createdAt: Date;
  };
}

const userBuilder = KyselyFactory.createBuilder<Database, 'users'>({
  table: 'users',
  defaults: async (attrs) => ({
    name: 'John Doe',
    email: `user${Date.now()}@example.com`,
    createdAt: new Date(),
  }),
});

const builders = {
  user: userBuilder,
};

export type Builders = typeof builders;
export type Seeds = Record<string, any>;

const factory = new KyselyFactory<Database, Builders, Seeds>(
  builders,
  {},
  {} as any,
);

factory.insert('user', {
  name: 'Jane Doe',
  email: `user${Date.now()}@example.com`,
  createdAt: new Date(),
});
