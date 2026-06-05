export type JwtUser = {
  sub: string; // Standard JWT subject (User ID)
  id: string; // Added for convenience
  branchId: string;
  businessTypeId: string;
  phone: string;
  username?: string;
  isPhoneVerified: boolean;
  role: string;
  businessId: string;
  isMainBranch: boolean;
  iat?: number; // Issued at (added automatically by JWT)
  exp?: number; // Expiration (added automatically by JWT)
};
