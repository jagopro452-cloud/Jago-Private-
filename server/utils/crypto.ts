import bcrypt from "bcryptjs";

/**
 * Standardized bcrypt rounds for password hashing
 * Higher rounds = better security but slower
 * 12 rounds ≈ 40ms on modern hardware (acceptable for production)
 */
export const PASSWORD_HASH_ROUNDS = 12;

/**
 * Hash a password with consistent rounds
 * ALWAYS use this function instead of bcrypt.hash directly
 * 
 * @param password - Plain text password to hash
 * @returns Promise resolving to bcrypt hash
 * @throws Error if password is empty
 */
export async function hashPassword(password: string): Promise<string> {
  const trimmed = String(password || "").trim();
  if (!trimmed) {
    throw new Error("Password cannot be empty");
  }
  return bcrypt.hash(trimmed, PASSWORD_HASH_ROUNDS);
}

/**
 * Verify a password against its hash
 * ALWAYS use this function instead of bcrypt.compare directly
 * Never throws - returns false on error (constant-time verification)
 * 
 * @param password - Plain text password from user
 * @param hash - Hashed password from database
 * @returns Promise<boolean> - true if password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  try {
    const trimmed = String(password || "").trim();
    const storedHash = String(hash || "").trim();
    
    if (!trimmed || !storedHash) {
      return false;
    }
    
    return await bcrypt.compare(trimmed, storedHash);
  } catch (err) {
    console.error("[crypto] Password verification error:", (err as any).message);
    return false;
  }
}

/**
 * Check if a password hash was created with the current PASSWORD_HASH_ROUNDS
 * Useful for detecting outdated hashes that should be re-hashed
 * 
 * @param hash - Bcrypt hash string
 * @returns True if hash was created with current rounds config
 */
export function isHashCurrent(hash: string): boolean {
  try {
    // Bcrypt hash format: $2a$12$... where 12 is the rounds
    const match = hash.match(/^\$2[aby]\$(\d{2})\$/);
    if (!match) return false;
    const hashRounds = parseInt(match[1], 10);
    return hashRounds === PASSWORD_HASH_ROUNDS;
  } catch {
    return false;
  }
}
