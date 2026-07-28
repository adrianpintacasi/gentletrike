export type UserRole = 'passenger' | 'rider' | 'admin';
export type AdminSubRole = 'super_admin' | 'staff';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  first_name?: string;
  last_name?: string;
  contact_number?: string;
  employee_id?: string;
  department?: string;
  sub_role?: AdminSubRole;
  account_status?: 'active' | 'suspended' | 'banned';
  passenger_cancellations?: number;
  created_at?: string;
}

