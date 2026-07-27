export type UserRole = 'passenger' | 'rider' | 'admin';
export type AdminSubRole = 'super_admin' | 'staff';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  employee_id?: string;
  department?: string;
  sub_role?: AdminSubRole;
  created_at?: string;
}

