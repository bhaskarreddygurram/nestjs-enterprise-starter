import { SortOrder } from '../utils/sort.util';

/**
 * ORM-free paging vocabulary shared by every entity module. Services speak in
 * these types; only a repository turns them into `skip` / `take` / `orderBy`.
 */

/** One page of a list query. `F` is the entity's sortable-field union. */
export interface PageRequest<F extends string = string> {
  skip: number;
  take: number;
  /** Applied in order; produced by `parseSort` against the entity whitelist. */
  sort: Array<Partial<Record<F, SortOrder>>>;
}

/** A page of items plus the total number of rows matching the filter. */
export interface Page<T> {
  items: T[];
  total: number;
}
