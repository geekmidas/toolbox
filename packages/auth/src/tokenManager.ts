import jwt from 'jsonwebtoken';
import type ms from 'ms';

export interface TokenPayload {
  userId: string;
  email?: string;
  [key: string]: any;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenManagerOptions {
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenExpiresIn?: ms.StringValue;
  refreshTokenExpiresIn?: ms.StringValue;
}

export interface DecodedToken extends TokenPayload {
  iat: number;
  exp: number;
}

export class TokenManager {
  private accessTokenSecret: string;
  private refreshTokenSecret: string;
  private accessTokenExpiresIn: ms.StringValue;
  private refreshTokenExpiresIn: ms.StringValue;

  constructor(options: TokenManagerOptions) {
    this.accessTokenSecret = options.accessTokenSecret;
    this.refreshTokenSecret = options.refreshTokenSecret;
    this.accessTokenExpiresIn = options.accessTokenExpiresIn || '15m';
    this.refreshTokenExpiresIn = options.refreshTokenExpiresIn || '7d';
  }

  generateTokenPair(payload: TokenPayload): TokenPair {
    const accessToken = jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.accessTokenExpiresIn,
    });

    const refreshToken = jwt.sign(payload, this.refreshTokenSecret, {
      expiresIn: this.refreshTokenExpiresIn,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  verifyAccessToken(token: string): DecodedToken {
    try {
      return jwt.verify(token, this.accessTokenSecret) as DecodedToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid access token: ${message}`);
    }
  }

  verifyRefreshToken(token: string): DecodedToken {
    try {
      return jwt.verify(token, this.refreshTokenSecret) as DecodedToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid refresh token: ${message}`);
    }
  }

  refreshAccessToken(refreshToken: string): string {
    const decoded = this.verifyRefreshToken(refreshToken);

    // Remove JWT specific fields before creating new token
    const { iat, exp, ...payload } = decoded;

    return jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.accessTokenExpiresIn,
    });
  }

  decodeToken(token: string): DecodedToken | null {
    try {
      return jwt.decode(token) as DecodedToken;
    } catch {
      return null;
    }
  }

  isTokenExpired(token: string): boolean {
    const decoded = this.decodeToken(token);
    if (!decoded) return true;

    const now = Math.floor(Date.now() / 1000);
    return decoded.exp < now;
  }

  getTokenExpiration(token: string): Date | null {
    const decoded = this.decodeToken(token);
    if (!decoded) return null;

    return new Date(decoded.exp * 1000);
  }
}
