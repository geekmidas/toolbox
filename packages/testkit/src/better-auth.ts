import {
  type DBAdapterDebugLogOption,
  type Where,
  createAdapterFactory,
} from 'better-auth/adapters';

interface MemoryAdapterConfig {
  debugLogs?: DBAdapterDebugLogOption;
  usePlural?: boolean;
  initialData?: Record<string, any[]>;
}

class MemoryStore {
  constructor(
    initialData?: Record<string, any[]>,
    private readonly data: Map<string, any> = new Map(),
  ) {
    if (initialData) {
      for (const [model, records] of Object.entries(initialData)) {
        const modelData = new Map();
        for (const record of records) {
          modelData.set(record.id, { ...record });
        }
        this.data.set(model, modelData);
      }
    }
  }

  getModel(modelName: string): Map<string, any> {
    if (!this.data.has(modelName)) {
      this.data.set(modelName, new Map());
    }
    return this.data.get(modelName)!;
  }

  clear() {
    this.data.clear();
  }

  getAllData() {
    const result: Record<string, any[]> = {};
    for (const [model, records] of this.data.entries()) {
      result[model] = Array.from(records.values());
    }
    return result;
  }
}

function matchesWhere(record: any, where?: Where[]): boolean {
  if (!where || where.length === 0) return true;

  let result: boolean | null = null;

  for (const condition of where) {
    const { field, value, operator = 'eq', connector = 'AND' } = condition;
    const recordValue = record[field];

    let matches = false;

    switch (operator) {
      case 'eq':
        matches = recordValue === value;
        break;
      case 'ne':
        matches = recordValue !== value;
        break;
      case 'lt':
        matches = recordValue < value;
        break;
      case 'lte':
        matches = recordValue <= value;
        break;
      case 'gt':
        matches = recordValue > value;
        break;
      case 'gte':
        matches = recordValue >= value;
        break;
      case 'in':
        matches = Array.isArray(value) && value.includes(recordValue);
        break;
      case 'not_in':
        matches = Array.isArray(value) && !value.includes(recordValue);
        break;
      case 'contains':
        matches =
          typeof recordValue === 'string' &&
          typeof value === 'string' &&
          recordValue.includes(value);
        break;
      case 'starts_with':
        matches =
          typeof recordValue === 'string' &&
          typeof value === 'string' &&
          recordValue.startsWith(value);
        break;
      case 'ends_with':
        matches =
          typeof recordValue === 'string' &&
          typeof value === 'string' &&
          recordValue.endsWith(value);
        break;
      default:
        matches = recordValue === value;
    }

    // Apply connector logic
    if (result === null) {
      result = matches;
    } else if (connector === 'OR') {
      result = result || matches;
    } else {
      // Default: AND
      result = result && matches;
    }
  }

  return result ?? true;
}
type SortBy = {
  field: string;
  direction: 'asc' | 'desc';
};

function applySorting(records: any[], sortBy?: SortBy): any[] {
  if (!sortBy) return records;

  const { field, direction } = sortBy;

  return records.sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];

    if (aVal === bVal) return 0;
    if (aVal == null) return direction === 'asc' ? -1 : 1;
    if (bVal == null) return direction === 'asc' ? 1 : -1;

    const comparison = aVal < bVal ? -1 : 1;
    return direction === 'asc' ? comparison : -comparison;
  });
}

export const memoryAdapter = (
  config: MemoryAdapterConfig = {},
  store = new Map(),
) => {
  const storeInstance = new MemoryStore(config.initialData, store);

  const adapterInstance = createAdapterFactory({
    config: {
      adapterId: 'memory-adapter',
      adapterName: 'Memory Adapter',
      usePlural: config.usePlural ?? false,
      debugLogs: config.debugLogs ?? false,
      supportsJSON: true,
      supportsDates: true,
      supportsBooleans: true,
      supportsNumericIds: false,
    },

    adapter: ({
      debugLog,
      transformInput,
      transformOutput,
      getModelName,
      transformWhereClause,
    }) => ({
      create: async ({ data, model, select }) => {
        debugLog('CREATE', { model, data });
        const modelName = getModelName(model);
        const modelData = storeInstance.getModel(modelName);

        const transformedData = await transformInput(data, model, 'create');

        if (!transformedData.id) {
          transformedData.id = crypto.randomUUID();
        }

        modelData.set(transformedData.id, { ...transformedData, ...data });

        if (data.email_address) {
          modelData.set(transformedData.id, {
            ...transformedData,
            email: data.email_address,
          });
        }
        const created = modelData.get(transformedData.id);

        const out = (await transformOutput(created, model, select)) as any;

        return out;
      },

      findOne: async ({ where, model, select }) => {
        debugLog('FIND_ONE', { model, where });
        const modelName = getModelName(model);
        const modelData = storeInstance.getModel(modelName);
        const transformedWhere = transformWhereClause({ model, where });

        for (const record of modelData.values()) {
          if (matchesWhere(record, transformedWhere)) {
            const t = (await transformOutput(record, model, select)) as any;

            return t;
          }
        }
        return null;
      },

      findMany: async ({ where, model, limit, offset, sortBy, select }) => {
        debugLog('FIND_MANY', { model, where });

        const modelName = getModelName(model);
        const modelData = storeInstance.getModel(modelName);
        const transformedWhere = transformWhereClause({ model, where });

        let results = Array.from(modelData.values()).filter((record) =>
          matchesWhere(record, transformedWhere),
        );

        if (sortBy) {
          results = applySorting(results, sortBy);
        }

        if (offset) {
          results = results.slice(offset);
        }
        if (limit) {
          results = results.slice(0, limit);
        }

        return Promise.all(
          results.map(async (record) => {
            const transformed = await transformOutput(record, model, select);

            return transformed;
          }),
        );
      },

      update: async ({ where, update, model, select }) => {
        debugLog('UPDATE', { model, where });

        const modelName = getModelName(model);
        const modelData = storeInstance.getModel(modelName);
        const transformedWhere = transformWhereClause({ model, where });

        for (const [id, record] of modelData.entries()) {
          if (matchesWhere(record, transformedWhere)) {
            const transformedData = await transformInput(
              update as any,
              model,
              'update',
            );
            const updated = { ...record, ...transformedData };
            modelData.set(id, updated);
            return transformOutput(updated, model, select) as any;
          }
        }
        return null;
      },

      updateMany: async ({ where, update, model }) => {
        debugLog('UPDATE_MANY', { model, where });
        const modelName = getModelName(model);
        const modelData = storeInstance.getModel(modelName);
        const transformedWhere = transformWhereClause({ model, where });

        let count = 0;
        const transformedData = await transformInput(update, model, 'update');

        for (const [id, record] of modelData.entries()) {
          if (matchesWhere(record, transformedWhere)) {
            modelData.set(id, { ...record, ...transformedData });
            count++;
          }
        }
        return count;
      },

      delete: async ({ where, model }) => {
        debugLog('DELETE', { model, where });
        const modelName = getModelName(model);
        const modelData = storeInstance.getModel(modelName);

        for (const [id, record] of modelData.entries()) {
          if (matchesWhere(record, where)) {
            modelData.delete(id);
            return;
          }
        }
      },

      deleteMany: async ({ where, model }) => {
        debugLog('DELETE_MANY', { model, where });
        const modelName = getModelName(model);
        const modelData = storeInstance.getModel(modelName);

        const toDelete: string[] = [];
        for (const [id, record] of modelData.entries()) {
          if (matchesWhere(record, where)) {
            toDelete.push(id);
          }
        }

        toDelete.forEach((id) => modelData.delete(id));
        return toDelete.length;
      },

      count: async ({ where, model }) => {
        const modelName = getModelName(model);
        const modelData = storeInstance.getModel(modelName);

        return Array.from(modelData.values()).filter((record) =>
          matchesWhere(record, where),
        ).length;
      },
    }),
  });

  // Add utility methods to the adapter
  return Object.assign(adapterInstance, {
    clear: () => store.clear(),
    getAllData: () => storeInstance.getAllData(),
    getStore: () => store,
  });
};
