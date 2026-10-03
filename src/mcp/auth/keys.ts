/**
 * Key Management and JWKS (JSON Web Key Set) for CTN OAuth 2.1.
 *
 * Implements:
 *  - RSA-2048 keypair generation / loading (RS256)
 *  - JWKS endpoint publishing (RFC 7517)
 *  - Dedicated signing and verification functions
 *  - Key ID (kid) rotation support
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import logger from "../../utils/logger";

const CTX = "OAuthKeys";

export const KEY_ID = "ctn-oauth-key-1";
export const OAUTH_ALGORITHM = "RS256";

interface KeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  jwk: {
    kty: string;
    use: string;
    alg: string;
    kid: string;
    n: string;
    e: string;
  };
}

let cachedKeyPair: KeyPair | null = null;

/**
 * Loads or initializes the RSA keypair.
 * If OAUTH_PRIVATE_KEY is supplied in environment variables, it uses that.
 * Otherwise it persists to a local keyfile (.keys/oauth-rs256.json) so keys remain stable across restarts.
 */
export function getKeyPair(): KeyPair {
  if (cachedKeyPair) {
    return cachedKeyPair;
  }

  // 1. Check environment variables
  if (process.env.OAUTH_PRIVATE_KEY && process.env.OAUTH_PUBLIC_KEY) {
    try {
      const privateKeyPem = process.env.OAUTH_PRIVATE_KEY.replace(/\\n/g, "\n");
      const publicKeyPem = process.env.OAUTH_PUBLIC_KEY.replace(/\\n/g, "\n");
      const pubKeyObj = crypto.createPublicKey(publicKeyPem);
      const exportedJwk = pubKeyObj.export({ format: "jwk" }) as any;

      cachedKeyPair = {
        privateKeyPem,
        publicKeyPem,
        jwk: {
          kty: "RSA",
          use: "sig",
          alg: OAUTH_ALGORITHM,
          kid: KEY_ID,
          n: exportedJwk.n,
          e: exportedJwk.e
        }
      };
      return cachedKeyPair;
    } catch (err: any) {
      logger.warn(`Failed to parse OAUTH_PRIVATE_KEY from environment: ${err.message}`, CTX);
    }
  }

  // 2. Check local key storage file
  const keyDir = path.resolve(process.cwd(), ".keys");
  const keyFile = path.join(keyDir, "oauth-rs256.json");

  try {
    if (fs.existsSync(keyFile)) {
      const data = JSON.parse(fs.readFileSync(keyFile, "utf-8"));
      if (data.privateKeyPem && data.publicKeyPem && data.jwk) {
        cachedKeyPair = data;
        return cachedKeyPair!;
      }
    }
  } catch (readErr: any) {
    logger.warn(`Failed to read key file ${keyFile}: ${readErr.message}`, CTX);
  }

  // 3. Generate a new RSA-2048 keypair
  logger.info("Generating new RSA-2048 keypair for OAuth RS256 token signing...", CTX);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  const pubKeyObj = crypto.createPublicKey(publicKey);
  const exportedJwk = pubKeyObj.export({ format: "jwk" }) as any;

  const newKeyPair: KeyPair = {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    jwk: {
      kty: "RSA",
      use: "sig",
      alg: OAUTH_ALGORITHM,
      kid: KEY_ID,
      n: exportedJwk.n,
      e: exportedJwk.e
    }
  };

  try {
    if (!fs.existsSync(keyDir)) {
      fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(keyFile, JSON.stringify(newKeyPair, null, 2), { mode: 0o600 });
    logger.info(`RSA keypair saved to ${keyFile}`, CTX);
  } catch (writeErr: any) {
    logger.warn(`Could not persist key file: ${writeErr.message}. Operating with in-memory key.`, CTX);
  }

  cachedKeyPair = newKeyPair;
  return cachedKeyPair;
}

/**
 * Returns the public JWKS document (RFC 7517).
 */
export function getJwks(): { keys: any[] } {
  const pair = getKeyPair();
  return {
    keys: [pair.jwk]
  };
}

/**
 * Signs a payload with RS256 using the OAuth private key.
 */
export function signOAuthJwt(payload: object, options: jwt.SignOptions = {}): string {
  const pair = getKeyPair();
  return jwt.sign(payload, pair.privateKeyPem, {
    algorithm: OAUTH_ALGORITHM,
    keyid: KEY_ID,
    ...options
  });
}

/**
 * Verifies an RS256 JWT using the OAuth public key.
 */
export function verifyOAuthJwt<T = any>(token: string, options: jwt.VerifyOptions = {}): T {
  const decodedHeader = jwt.decode(token, { complete: true }) as any;
  const alg = decodedHeader?.header?.alg;

  if (alg === "HS256") {
    const secret = process.env.MCP_OAUTH_TOKEN_SECRET || "";
    return jwt.verify(token, secret, {
      algorithms: ["HS256"],
      ...options
    }) as T;
  }

  const pair = getKeyPair();
  return jwt.verify(token, pair.publicKeyPem, {
    algorithms: [OAUTH_ALGORITHM],
    ...options
  }) as T;
}

export function getPublicKey(): string {
  return getKeyPair().publicKeyPem;
}

