export const COLLECTIONS = {
  payments: { transactionId: 'text', transactionType: 'text', amount: 'number', currency: 'text', merchant: 'text', cardLastDigits: 'text', transactionDate: 'number', messageTimestamp: 'number', syncedAt: 'number', bankSenderId: 'text', excludedFromAnalytics: 'boolean' },
  failedPayments: { transactionId: 'text', transactionType: 'text', amount: 'number', currency: 'text', merchant: 'text', cardLastDigits: 'text', transactionDate: 'number', messageTimestamp: 'number', syncedAt: 'number', bankSenderId: 'text' },
  credits: { transactionId: 'text', transactionType: 'text', amount: 'number', currency: 'text', counterparty: 'text', cardLastDigits: 'text', transactionDate: 'number', messageTimestamp: 'number', syncedAt: 'number', bankSenderId: 'text', excludedFromAnalytics: 'boolean' },
  categories: { name: 'text', color: 'text', icon: 'text', isDefault: 'boolean', bucket: 'text', targetAmount: 'number', frequencyMonths: 'number', rolloverEnabled: 'boolean' },
  bankSenders: { senderId: 'text', displayName: 'text', enabled: 'boolean', createdAt: 'number' },
  budgetPlans: { planMonth: 'text', expectedIncome: 'number', expectedIncomeAuto: 'boolean', flexPool: 'number', flexPoolAuto: 'boolean', savingsTarget: 'number', createdAt: 'number', updatedAt: 'number' },
  merchantCategoryOverrides: { merchant: 'text', categoryId: 'text', createdAt: 'number' },
  transactionCategoryOverrides: { paymentId: 'text', categoryId: 'text', createdAt: 'number' },
  mustPayItems: { title: 'text', amountGEL: 'number', lastPaidAt: 'nullable-number', isRecurring: 'boolean', notes: 'text', dueDate: 'number', createdAt: 'number', updatedAt: 'number' },
  mustPayState: { key: 'text', currentPotGEL: 'number', updatedAt: 'number' },
  exchangeRates: { date: 'text', currency: 'text', rate: 'number' },
};
export const TRANSACTIONS = new Set(['payments', 'failedPayments', 'credits']);
export const SUPPORTED_SENDERS = new Set(['TBC SMS', 'TBC']);
const UNIQUE_FIELDS = { bankSenders: 'senderId', budgetPlans: 'planMonth', mustPayState: 'key', merchantCategoryOverrides: 'merchant', transactionCategoryOverrides: 'paymentId' };
export { UNIQUE_FIELDS };

export class InputError extends Error {
  constructor(message = 'Invalid request', status = 400) { super(message); this.status = status; }
}

export function validatedFields(collection, value) {
  const shape = COLLECTIONS[collection];
  if (!shape || !value || typeof value !== 'object' || Array.isArray(value)) throw new InputError();
  const result = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === 'id') continue;
    const type = Object.hasOwn(shape, key) ? shape[key] : null;
    if (!type) throw new InputError('Unsupported field');
    if (type === 'nullable-number' && val === null) { result[key] = null; continue; }
    if (type === 'number' || type === 'nullable-number') {
      if (typeof val !== 'number' || !Number.isFinite(val) || Math.abs(val) > (/(?:At|Date|Timestamp)$/.test(key) ? 8.64e15 : 1e12)) throw new InputError('Invalid number');
    } else if (type === 'boolean') {
      if (typeof val !== 'boolean') throw new InputError('Invalid boolean');
    } else if (typeof val !== 'string' || val.length > 300 || /[\x00-\x08\x0b-\x1f]/u.test(val)) {
      throw new InputError('Invalid text');
    }
    result[key] = val;
  }
  if (result.senderId !== undefined && !SUPPORTED_SENDERS.has(result.senderId)) throw new InputError('Unsupported bank sender');
  if (result.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(result.color)) throw new InputError('Invalid color');
  if (result.bucket !== undefined && !['fixed', 'flex', 'non_monthly'].includes(result.bucket)) throw new InputError('Invalid budget bucket');
  if (result.planMonth !== undefined && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(result.planMonth)) throw new InputError('Invalid month');
  if (result.key !== undefined && result.key !== 'singleton') throw new InputError('Invalid state key');
  if (result.currency !== undefined && !/^[A-Z]{3}$/.test(result.currency)) throw new InputError('Invalid currency');
  if (collection === 'exchangeRates' && (result.rate !== undefined && result.rate <= 0)) throw new InputError('Invalid rate');
  return result;
}

export function agentRow(row, collection) {
  const { id, transactionType, amount, currency, transactionDate, bankSenderId, excludedFromAnalytics } = row;
  return { id, collection, transactionType, amount, currency, transactionDate, bankSenderId, excludedFromAnalytics: !!excludedFromAnalytics };
}
