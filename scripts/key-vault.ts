/**
 * key-vault.ts - API Key 加密存储模块
 *
 * 使用 AES-256-GCM 加密存储交易所 API Key，
 * 用户设置主密码，通过 PBKDF2 派生加密密钥。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ─── 类型定义 ───

export interface ExchangeCredential {
  id: string;
  exchangeId: string;
  label: string;
  apiKey: string;
  secret: string;
  passphrase?: string;       // OKX 等交易所需要
  permissions: string[];     // ['spot', 'futures'] — 禁止 'withdraw'
  ipWhitelist?: string[];
  createdAt: number;
  updatedAt: number;
}

interface EncryptedPayload {
  iv: string;        // hex
  salt: string;      // hex
  tag: string;       // hex (GCM auth tag)
  data: string;      // hex (encrypted)
  version: number;   // 加密版本，方便未来升级
}

interface VaultFile {
  version: number;
  credentials: EncryptedPayload[];
}

// ─── 常量 ───

const VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;  // OWASP 2024 推荐值
const KEY_LENGTH = 32;               // AES-256
const SALT_LENGTH = 32;
const IV_LENGTH = 16;

// ─── KeyVault 类 ───

export class KeyVault {
  private vaultPath: string;
  private cachedCredentials: ExchangeCredential[] | null = null;
  private cacheExpiry: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 分钟后缓存失效

  constructor(dataDir: string) {
    this.vaultPath = path.join(dataDir, 'vault', 'exchanges.enc.json');
  }

  // ─── 公开方法 ───

  /**
   * 添加交易所凭证
   */
  async addCredential(
    masterPassword: string,
    credential: Omit<ExchangeCredential, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ExchangeCredential> {
    // 安全检查：拒绝含提现权限的 Key
    if (credential.permissions.includes('withdraw')) {
      throw new Error(
        'SECURITY: 拒绝存储含提现(withdraw)权限的 API Key。' +
        '请在交易所后台创建仅含交易权限的 Key。'
      );
    }

    const fullCredential: ExchangeCredential = {
      ...credential,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const credentials = await this.loadAll(masterPassword);
    credentials.push(fullCredential);
    await this.saveAll(masterPassword, credentials);
    this.invalidateCache();

    return fullCredential;
  }

  /**
   * 获取所有凭证（解密后）
   */
  async listCredentials(masterPassword: string): Promise<ExchangeCredential[]> {
    if (this.cachedCredentials && Date.now() < this.cacheExpiry) {
      return this.cachedCredentials;
    }

    const credentials = await this.loadAll(masterPassword);
    this.cachedCredentials = credentials;
    this.cacheExpiry = Date.now() + this.cacheTTL;
    return credentials.map(c => ({ ...c }));
  }

  /**
   * 获取指定交易所的凭证
   */
  async getCredential(
    masterPassword: string,
    exchangeId: string,
    label?: string
  ): Promise<ExchangeCredential | undefined> {
    const all = await this.listCredentials(masterPassword);
    return all.find(c =>
      c.exchangeId === exchangeId && (!label || c.label === label)
    );
  }

  /**
   * 删除凭证
   */
  async removeCredential(masterPassword: string, credentialId: string): Promise<boolean> {
    const credentials = await this.loadAll(masterPassword);
    const filtered = credentials.filter(c => c.id !== credentialId);
    if (filtered.length === credentials.length) return false;

    await this.saveAll(masterPassword, filtered);
    this.invalidateCache();
    return true;
  }

  /**
   * 更新凭证
   */
  async updateCredential(
    masterPassword: string,
    credentialId: string,
    updates: Partial<Pick<ExchangeCredential, 'label' | 'apiKey' | 'secret' | 'passphrase' | 'permissions' | 'ipWhitelist'>>
  ): Promise<ExchangeCredential | null> {
    if (updates.permissions?.includes('withdraw')) {
      throw new Error('SECURITY: 拒绝含提现(withdraw)权限的 API Key。');
    }

    const credentials = await this.loadAll(masterPassword);
    const index = credentials.findIndex(c => c.id === credentialId);
    if (index === -1) return null;

    credentials[index] = {
      ...credentials[index],
      ...updates,
      updatedAt: Date.now(),
    };

    await this.saveAll(masterPassword, credentials);
    this.invalidateCache();
    return credentials[index];
  }

  /**
   * 验证主密码是否正确
   */
  async verifyPassword(masterPassword: string): Promise<boolean> {
    try {
      await this.loadAll(masterPassword);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Vault 文件是否存在
   */
  exists(): boolean {
    return fs.existsSync(this.vaultPath);
  }

  /**
   * 对 API Key 做脱敏处理（用于日志/显示）
   */
  static maskKey(key: string): string {
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '...' + key.slice(-4);
  }

  // ─── 加密 / 解密 ───

  private encrypt(plaintext: string, masterPassword: string): EncryptedPayload {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = crypto.pbkdf2Sync(
      masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512'
    );
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
      version: VAULT_VERSION,
    };
  }

  private decrypt(payload: EncryptedPayload, masterPassword: string): string {
    const salt = Buffer.from(payload.salt, 'hex');
    const key = crypto.pbkdf2Sync(
      masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512'
    );
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // ─── 文件读写 ───

  private async loadAll(masterPassword: string): Promise<ExchangeCredential[]> {
    if (!fs.existsSync(this.vaultPath)) {
      return [];
    }

    const raw = fs.readFileSync(this.vaultPath, 'utf8');
    const vault: VaultFile = JSON.parse(raw);

    return vault.credentials.map(enc => {
      const json = this.decrypt(enc, masterPassword);
      return JSON.parse(json) as ExchangeCredential;
    });
  }

  private async saveAll(
    masterPassword: string,
    credentials: ExchangeCredential[]
  ): Promise<void> {
    const dir = path.dirname(this.vaultPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const vault: VaultFile = {
      version: VAULT_VERSION,
      credentials: credentials.map(cred =>
        this.encrypt(JSON.stringify(cred), masterPassword)
      ),
    };

    // 写入临时文件再 rename，防止写入中断导致数据损坏
    const tmpPath = this.vaultPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(vault, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.vaultPath);

    // 设置文件权限为 600（仅 owner 可读写）
    fs.chmodSync(this.vaultPath, 0o600);
  }

  private invalidateCache(): void {
    this.cachedCredentials = null;
    this.cacheExpiry = 0;
  }
}
