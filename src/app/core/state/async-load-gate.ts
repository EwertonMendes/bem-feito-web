export class AsyncLoadGate {
  private loaded = false;
  private inFlight: Promise<void> | null = null;

  get isLoaded(): boolean {
    return this.loaded;
  }

  run(loader: () => Promise<void>, force = false): Promise<void> {
    if (this.loaded && !force) return Promise.resolve();
    if (this.inFlight) return this.inFlight;

    this.inFlight = loader()
      .then(() => {
        this.loaded = true;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  reset(): void {
    this.loaded = false;
    this.inFlight = null;
  }
}
