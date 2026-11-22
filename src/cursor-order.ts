export interface CursorOrder {
  expression: string;
  direction: 'ASC' | 'DESC';
  type: 'uuid' | 'text' | 'timestamptz' | 'integer' | 'numeric' | 'real';
}
