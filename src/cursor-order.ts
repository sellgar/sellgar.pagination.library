export interface CursorOrder {
  expression: string;
  direction: 'ASC' | 'DESC';
  type: 'uuid' | 'text' | 'timestamp' | 'timestamptz' | 'integer' | 'numeric' | 'real';
}
