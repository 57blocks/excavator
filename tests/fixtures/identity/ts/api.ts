export const api = {
  list() {
    return [];
  },
  get: (id: string) => id,
  nested: {
    deep() {
      return true;
    },
  },
};

export class Api {
  list(): string[] {
    return [];
  }

  get(id: string): string {
    return id;
  }
}
