/** Small readers for product JSON, which a view must not assume the shape of. */

export type Table = Record<string, any>;

export const isTable = (value: unknown): value is Table => typeof value === "object" && value !== null && !Array.isArray(value);

/** The items of a list field that are objects; a field that is not a list is an empty list. */
export const listOf = (value: unknown): Table[] => (Array.isArray(value) ? value.filter(isTable) : []);

/** The strings of a list field, as text (a residual assumption or a path). */
export const textsOf = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
