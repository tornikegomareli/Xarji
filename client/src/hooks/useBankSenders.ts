import { useMemo } from "react";
import { db } from "../lib/instant";
import { id } from "../lib/local-mode";

export function useBankSenders() {
  const { data, isLoading, error } = db.useQuery({ bankSenders: {} });

  const senders = useMemo(() => {
    if (!data?.bankSenders) return [];
    return [...data.bankSenders].sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
    );
  }, [data?.bankSenders]);

  const addSender = async (senderId: string, displayName: string) => {
    const newId = id();
    await db.transact(
      db.tx.bankSenders[newId].update({
        senderId,
        displayName,
        enabled: true,
        createdAt: Date.now(),
      })
    );
    return newId;
  };

  const toggleSender = async (bankSenderId: string, enabled: boolean) => {
    await db.transact(
      db.tx.bankSenders[bankSenderId].update({ enabled })
    );
  };

  const deleteSender = async (bankSenderId: string) => {
    await db.transact(
      db.tx.bankSenders[bankSenderId].delete()
    );
  };

  return { senders, isLoading, error, addSender, toggleSender, deleteSender };
}
