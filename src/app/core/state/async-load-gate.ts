export class AsyncLoadGate {
  private loaded = false;
  private inFlight: Promise<void> | null = null;
  private refreshRequested = false;

  get isLoaded(): boolean {
    return this.loaded;
  }

  run(loader: () => Promise<void>, force = false): Promise<void> {
    if (this.inFlight) {
      if (force) this.refreshRequested = true;
      return this.inFlight;
    }

    if (this.loaded && !force) return Promise.resolve();

    const execute = async (): Promise<void> => {
      do {
        this.refreshRequested = false;
        await loader();
        this.loaded = true;
      } while (this.refreshRequested);
    };

    this.inFlight = execute().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  reset(): void {
    this.loaded = false;
    this.inFlight = null;
    this.refreshRequested = false;
  }
}
