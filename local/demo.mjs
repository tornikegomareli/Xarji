import { importMessages } from './import.mjs';

export function seedDemo(store, now = new Date()) {
  if (store.meta('demoSeed')) return;
  if (['payments', 'credits', 'failedPayments'].some(name => store.rows(name).length)) throw new Error('Demo seeding requires an empty ledger');
  const merchants = ['DEMO CARREFOUR', 'DEMO WOLT', 'DEMO BOLTTAXI', 'DEMO AVERSI', 'DEMO SOCAR', 'DEMO SPOTIFY'];
  const messages = [];
  for (let i = 1; i <= 90; i++) {
    const date = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - (i % 28)), 12, i % 60);
    const dmy = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    messages.push({ messageId: i, senderId: 'TBC SMS', timestamp: date.toISOString(), text: `${(5 + (i * 13) % 120).toFixed(2)} GEL\nVISA (***0000)\n${merchants[i % merchants.length]}\n${dmy}\nNashti: 9999.00 GEL` });
  }
  messages.push({ messageId: 100, senderId: 'TBC SMS', timestamp: now.toISOString(), text: `Charicxva: 4800.00 GEL\n${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}\nDEMO SALARY` });
  messages.push({ messageId: 101, senderId: 'TBC SMS', timestamp: now.toISOString(), text: 'TBC SMS Code: 123456\n47.80 GEL\nVISA (***0000)\nDEMO AUTHORIZATION' });
  importMessages(store, messages);
  store.transact([{ collection: 'mustPayItems', id: 'demo-rent', kind: 'update', value: { title: 'Demo rent', amountGEL: 900, isRecurring: false, createdAt: Date.now(), updatedAt: Date.now() } }, { collection: 'mustPayState', id: 'demo-pot', kind: 'update', value: { key: 'singleton', currentPotGEL: 4800, updatedAt: Date.now() } }]);
  store.meta('demoSeed', 'true');
}
