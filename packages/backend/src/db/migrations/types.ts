export interface Migration {
  id: string;
  up: string[];
  down: string[];
}
