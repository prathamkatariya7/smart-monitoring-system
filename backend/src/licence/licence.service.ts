import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface LicencePayload {
  organisation: string;
  edition: 'solo' | 'team' | 'enterprise';
  maxDevices: number;
  supportTermEnd: string;
  featureFlags: Record<string, boolean>;
  issuedAt: string;
}

interface LicenceFile {
  payload: LicencePayload;
  signature: string;
}

/**
 * Part 9.9: offline licence file, signature verified with a public key built
 * into the software, no phone-home. An expired term or exceeded device count
 * never stops data collection, viewing, or export -- it only blocks claiming
 * new devices/enabling new features and shows a banner (10% grace margin).
 */
@Injectable()
export class LicenceService {
  private readonly logger = new Logger(LicenceService.name);
  private cached: {
    payload: LicencePayload;
    valid: boolean;
    error?: string;
  } | null = null;

  constructor(private readonly config: ConfigService) {}

  load(): { payload: LicencePayload | null; valid: boolean; error?: string } {
    if (this.cached)
      return {
        payload: this.cached.valid ? this.cached.payload : null,
        valid: this.cached.valid,
        error: this.cached.error,
      };

    const filePath = this.config.get<string>('licence.filePath')!;
    const publicKeyPath = this.config.get<string>('licence.publicKeyPath')!;

    try {
      if (!fs.existsSync(filePath) || !fs.existsSync(publicKeyPath)) {
        this.cached = {
          payload: null as any,
          valid: false,
          error: 'Licence file or public key not found',
        };
        this.logger.warn(
          'No licence file found -- running unlicensed (claims will be blocked)',
        );
        return { payload: null, valid: false, error: this.cached.error };
      }

      const licence: LicenceFile = JSON.parse(
        fs.readFileSync(filePath, 'utf8'),
      );
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
      const canonical = JSON.stringify(licence.payload);
      const signatureValid = crypto.verify(
        'sha256',
        Buffer.from(canonical),
        { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING },
        Buffer.from(licence.signature, 'base64'),
      );

      if (!signatureValid) {
        this.cached = {
          payload: licence.payload,
          valid: false,
          error: 'Signature verification failed',
        };
        this.logger.error(
          'Licence signature verification FAILED -- treating as unlicensed',
        );
        return { payload: null, valid: false, error: this.cached.error };
      }

      this.cached = { payload: licence.payload, valid: true };
      this.logger.log(
        `Licence loaded: ${licence.payload.organisation} (${licence.payload.edition}, max ${licence.payload.maxDevices} devices)`,
      );
      return { payload: licence.payload, valid: true };
    } catch (err: any) {
      this.cached = { payload: null as any, valid: false, error: err.message };
      this.logger.error(`Failed to load licence: ${err.message}`);
      return { payload: null, valid: false, error: err.message };
    }
  }

  /** Invalidate the in-memory cache (e.g. after uploading a new licence file). */
  reload(): ReturnType<LicenceService['load']> {
    this.cached = null;
    return this.load();
  }

  /**
   * Removes the installed licence file (if any) and clears the cache. After this,
   * the service behaves exactly as if no licence was ever installed: new device
   * claims are blocked, but already-collected data, viewing, and export are
   * untouched -- same guarantee as an expired licence (Part 9.9).
   */
  deactivate(): void {
    const filePath = this.config.get<string>('licence.filePath')!;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    this.cached = null;
  }

  isExpired(): boolean {
    const { payload, valid } = this.load();
    if (!valid || !payload) return true;
    return new Date(payload.supportTermEnd).getTime() < Date.now();
  }

  /** Part 9.9: 10% device grace margin; claiming beyond that is blocked (never collection/viewing/export). */
  canClaimDevice(currentActiveDeviceCount: number): {
    allowed: boolean;
    reason?: string;
  } {
    const { payload, valid } = this.load();
    if (!valid || !payload) {
      return { allowed: false, reason: 'No valid licence installed' };
    }
    if (this.isExpired()) {
      return {
        allowed: false,
        reason: `Licence support term ended on ${payload.supportTermEnd} -- claiming new devices is blocked until renewed`,
      };
    }
    const graceLimit = Math.floor(payload.maxDevices * 1.1);
    if (currentActiveDeviceCount >= graceLimit) {
      return {
        allowed: false,
        reason: `Licence device limit reached (${payload.maxDevices}, +10% grace = ${graceLimit}); currently ${currentActiveDeviceCount}`,
      };
    }
    return { allowed: true };
  }

  status(): {
    installed: boolean;
    valid: boolean;
    expired: boolean;
    payload: LicencePayload | null;
    error?: string;
  } {
    const { payload, valid, error } = this.load();
    return {
      installed: payload !== null,
      valid,
      expired: this.isExpired(),
      payload,
      error,
    };
  }
}
