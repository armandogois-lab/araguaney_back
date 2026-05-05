export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: 'operator' | 'admin' | 'auditor';
  is_active: boolean;
};

export type JwtClaims = {
  sub: string;
  email?: string;
  role?: string;
  exp: number;
  iat: number;
};

export type LookupResult =
  | { kind: 'found'; user: AuthUser }
  | { kind: 'not_registered' }
  | { kind: 'deactivated' };
