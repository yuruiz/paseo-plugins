import { sealValue, type Envelope, type SealingTicket } from "../shared/sealing.js";

export function createSealedSender<T>(
  begin: () => Promise<SealingTicket>,
  send: (input: { ticketId: string; envelope: Envelope }) => Promise<T>,
) {
  let pending: { ticketId: string; envelope: Envelope } | null = null;
  let closed = false;
  const retry = async () => {
    if (!pending || closed) throw new Error("No pending submission.");
    const result = await send(pending);
    pending = null;
    return result;
  };
  return {
    async submit(value: unknown) {
      if (pending || closed) throw new Error("Resolve the pending submission first.");
      const ticket = await begin();
      if (closed) throw new Error("Form closed.");
      pending = { ticketId: ticket.id, envelope: sealValue(ticket, value) };
      return retry();
    },
    retry,
    hasPending: () => pending !== null && !closed,
    close() {
      closed = true;
      pending = null;
    },
  };
}
