interface Notice {
  agentId: string;
  expiresAt: number;
  message(): string | null;
  sent: boolean;
}

async function bounded<T>(call: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 5000);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class SecretNotifications {
  private readonly entries = new Map<string, Notice>();
  private running: Promise<void> | null = null;
  private closed = false;
  constructor(
    private readonly port: {
      idle(agentId: string): Promise<boolean>;
      send(agentId: string, message: string): Promise<unknown>;
    },
    private readonly now: () => number = Date.now,
  ) {}

  enqueue(id: string, notice: Omit<Notice, "sent">) {
    if (this.closed || this.entries.has(id)) return;
    this.prune();
    if (this.entries.size >= 128) throw new Error("Notification capacity is full.");
    this.entries.set(id, { ...notice, sent: false });
    void this.flush();
  }

  flush(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.running ??= this.deliver().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async deliver() {
    this.prune();
    for (const [id, notice] of this.entries) {
      if (notice.sent || this.closed) continue;
      try {
        if (!(await bounded(this.port.idle(notice.agentId), false))) continue;
        if (this.closed || this.entries.get(id) !== notice || notice.expiresAt <= this.now())
          continue;
        const text = notice.message();
        if (text === null) {
          this.entries.delete(id);
          continue;
        }
        notice.sent = true;
        const delivery = this.port.send(notice.agentId, text).then(
          () => true,
          () => {
            notice.sent = false;
            return false;
          },
        );
        await bounded(delivery, false);
      } catch {
        // Only metadata is retried; execution still requires an unconsumed grant.
      }
    }
  }

  removeAgent(agentId: string) {
    for (const [id, notice] of this.entries)
      if (notice.agentId === agentId) this.entries.delete(id);
  }
  private prune() {
    for (const [id, notice] of this.entries)
      if (notice.expiresAt <= this.now()) this.entries.delete(id);
  }
  close() {
    this.closed = true;
    this.entries.clear();
  }
}
