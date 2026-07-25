export type UserRole = 'passenger' | 'rider' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  created_at?: string;
}
