export interface AuthenticatedUser {
  userId: string;
  username: string;
  name: string;
  roles: string[]; // role codes, e.g. ADMIN, LAB_INCHARGE, ANALYST, AUDITOR, SUPPORT
  isAdmin: boolean;
  laboratoryIds: string[]; // labs this user may read/act in, per Part 4
}
