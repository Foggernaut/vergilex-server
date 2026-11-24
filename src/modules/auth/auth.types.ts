import type { LegalState } from '../legal/legal.js';

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  /** KVKK: güncel aydınlatma/koşullar kabul durumu (requireAuth doldurur). */
  legal?: LegalState;
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
