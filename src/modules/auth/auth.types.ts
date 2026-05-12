export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'user' | 'admin';
  credits: number;
  created_at: string;
  updated_at: string;
}
