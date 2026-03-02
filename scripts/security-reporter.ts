/**
 * security-reporter.ts - 定期安全报告
 *
 * 自动检查 API Key 安全状态，生成安全评分和建议。
 * 包括 Key 年龄、权限检测、IP 白名单、连接状态等检查项。
 */

import fs from 'node:fs';
import path from 'node:path';
import { KeyVault, type ExchangeCredential } from './key-vault.js';
import { ExchangeManager } from './exchange-manager.js';

// ─── 类型定义 ───

export interface SecurityCheckItem {
  name: string;
  status: 'pass' | 'warning' | 'fail';
  detail: string;
  score: number;
}

export interface ExchangeSecurityReport {
  exchangeId: string;
  label: string;
  checks: SecurityCheckItem[];
  score: number;
}

export interface SecurityReport {
  timestamp: number;
  overallScore: number;
  exchanges: ExchangeSecurityReport[];
  summary: string;
  recommendations: string[];
}

export interface SecurityReporterConfig {
  pollingMs: number;
  keyRotationWarningDays: number;
  keyRotationCriticalDays: number;
}

export interface SecurityReportEvent {
  type: 'report_generated';
  report: SecurityReport;
  message: string;
  timestamp: number;
}

type SecurityReportCallback = (event: SecurityReportEvent) => void | Promise<void>;

// ─── 默认配置 ───

const DEFAULT_CONFIG: SecurityReporterConfig = {
  pollingMs: 24 * 60 * 60 * 1000, // 24 小时
  keyRotationWarningDays: 90,
  keyRotationCriticalDays: 180,
};

// ─── SecurityReporter 类 ───

export class SecurityReporter {
  private config: SecurityReporterConfig;
  private configPath: string;
  private reportPath: string;
  private lastReport: SecurityReport | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private getPassword: (() => string) | null = null;
  private callbacks: SecurityReportCallback[] = [];
  private vault: KeyVault;
  private exchangeManager: ExchangeManager;

  constructor(
    dataDir: string,
    vault: KeyVault,
    exchangeManager: ExchangeManager
  ) {
    this.vault = vault;
    this.exchangeManager = exchangeManager;

    const dir = path.join(dataDir, 'security');
    this.configPath = path.join(dir, 'config.json');
    this.reportPath = path.join(dir, 'last-report.json');

    this.config = { ...DEFAULT_CONFIG, ...this.loadConfig() };
    this.loadLastReport();
  }

  // ─── 生命周期 ───

  start(getPassword: () => string): void {
    if (this.timeoutId) return;
    this.getPassword = getPassword;

    const _poll = async () => {
      try {
        const masterPassword = this.getPassword!();
        const report = await this.generateReport(masterPassword);
        await this.emitReport(report);
      } catch (err: any) {
        console.error('[SecurityReporter] 生成报告失败:', err.message);
      } finally {
        if (this.timeoutId !== null) {
          this.timeoutId = setTimeout(_poll, this.config.pollingMs);
        }
      }
    };

    this.timeoutId = setTimeout(_poll, 0);
  }

  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.getPassword = null;
  }

  isRunning(): boolean {
    return this.timeoutId !== null;
  }

  // ─── 配置管理 ───

  updateConfig(updates: Partial<SecurityReporterConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();

    if (updates.pollingMs && this.timeoutId && this.getPassword) {
      const getPassword = this.getPassword;
      this.stop();
      this.start(getPassword);
    }
  }

  getConfig(): SecurityReporterConfig {
    return { ...this.config };
  }

  onReport(callback: SecurityReportCallback): void {
    this.callbacks.push(callback);
  }

  // ─── 报告生成 ───

  /**
   * 生成安全报告（可手动调用）
   */
  async generateReport(masterPassword: string): Promise<SecurityReport> {
    const credentials = await this.vault.listCredentials(masterPassword);

    if (credentials.length === 0) {
      const report: SecurityReport = {
        timestamp: Date.now(),
        overallScore: 100,
        exchanges: [],
        summary: '未配置任何交易所 API Key。',
        recommendations: ['添加交易所 API Key 以开始使用。'],
      };
      this.lastReport = report;
      this.saveLastReport();
      return report;
    }

    const exchangeReports: ExchangeSecurityReport[] = [];
    const allRecommendations: string[] = [];

    for (const cred of credentials) {
      const checks: SecurityCheckItem[] = [];

      // 检查 1: API Key 年龄
      checks.push(this.checkKeyAge(cred));

      // 检查 2: 提现权限
      checks.push(await this.checkWithdrawPermission(masterPassword, cred));

      // 检查 3: IP 白名单
      checks.push(this.checkIpWhitelist(cred));

      // 检查 4: API 连接状态
      checks.push(await this.checkConnection(masterPassword, cred));

      const score = checks.reduce((sum, c) => sum + c.score, 0);
      const label = cred.label === 'default' ? '' : ` (${cred.label})`;

      exchangeReports.push({
        exchangeId: cred.exchangeId,
        label: cred.label,
        checks,
        score,
      });

      // 生成建议
      for (const check of checks) {
        if (check.status === 'fail') {
          allRecommendations.push(`${cred.exchangeId}${label}: ${check.detail}`);
        } else if (check.status === 'warning') {
          allRecommendations.push(`${cred.exchangeId}${label}: ${check.detail}`);
        }
      }
    }

    const overallScore = exchangeReports.length > 0
      ? Math.round(exchangeReports.reduce((sum, r) => sum + r.score, 0) / exchangeReports.length)
      : 100;

    let summary: string;
    if (overallScore >= 80) {
      summary = `安全评分 ${overallScore}/100 — 状态良好。`;
    } else if (overallScore >= 60) {
      summary = `安全评分 ${overallScore}/100 — 存在一些需要注意的安全问题。`;
    } else {
      summary = `安全评分 ${overallScore}/100 — 安全评分较低，请立即处理以下问题。`;
    }

    summary += ` 共检查 ${credentials.length} 个交易所 API Key。`;

    const report: SecurityReport = {
      timestamp: Date.now(),
      overallScore,
      exchanges: exchangeReports,
      summary,
      recommendations: [...new Set(allRecommendations)], // 去重
    };

    this.lastReport = report;
    this.saveLastReport();
    return report;
  }

  /**
   * 获取上次报告
   */
  getLastReport(): SecurityReport | null {
    return this.lastReport ? { ...this.lastReport } : null;
  }

  // ─── 安全检查项 ───

  private checkKeyAge(cred: ExchangeCredential): SecurityCheckItem {
    const ageDays = Math.floor((Date.now() - cred.createdAt) / (24 * 60 * 60 * 1000));

    if (ageDays < this.config.keyRotationWarningDays) {
      return {
        name: 'API Key 年龄',
        status: 'pass',
        detail: `Key 创建于 ${ageDays} 天前`,
        score: 25,
      };
    } else if (ageDays < this.config.keyRotationCriticalDays) {
      return {
        name: 'API Key 年龄',
        status: 'warning',
        detail: `Key 已使用 ${ageDays} 天，建议轮换（超过 ${this.config.keyRotationWarningDays} 天）`,
        score: 15,
      };
    } else {
      return {
        name: 'API Key 年龄',
        status: 'fail',
        detail: `Key 已使用 ${ageDays} 天，强烈建议立即轮换（超过 ${this.config.keyRotationCriticalDays} 天）`,
        score: 5,
      };
    }
  }

  private async checkWithdrawPermission(
    masterPassword: string,
    cred: ExchangeCredential
  ): Promise<SecurityCheckItem> {
    try {
      const { hasWithdraw } = await this.exchangeManager.detectPermissions(
        masterPassword, cred.exchangeId, cred.label
      );

      if (hasWithdraw) {
        return {
          name: '提现权限',
          status: 'fail',
          detail: '检测到 API Key 含有提现权限，强烈建议重新创建不含提现权限的 Key',
          score: 0,
        };
      }

      return {
        name: '提现权限',
        status: 'pass',
        detail: '未检测到提现权限',
        score: 25,
      };
    } catch {
      return {
        name: '提现权限',
        status: 'warning',
        detail: '无法检测权限（API 调用失败）',
        score: 10,
      };
    }
  }

  private checkIpWhitelist(cred: ExchangeCredential): SecurityCheckItem {
    if (cred.ipWhitelist && cred.ipWhitelist.length > 0) {
      return {
        name: 'IP 白名单',
        status: 'pass',
        detail: `已设置 ${cred.ipWhitelist.length} 个 IP 白名单`,
        score: 25,
      };
    }

    return {
      name: 'IP 白名单',
      status: 'warning',
      detail: '未设置 IP 白名单，建议在交易所后台配置',
      score: 10,
    };
  }

  private async checkConnection(
    masterPassword: string,
    cred: ExchangeCredential
  ): Promise<SecurityCheckItem> {
    try {
      await this.exchangeManager.getBalance(masterPassword, cred.exchangeId, cred.label);
      return {
        name: 'API 连接状态',
        status: 'pass',
        detail: 'API 连接正常',
        score: 25,
      };
    } catch (err: any) {
      return {
        name: 'API 连接状态',
        status: 'fail',
        detail: `API 连接失败：${err.message}。Key 可能已过期或被禁用。`,
        score: 0,
      };
    }
  }

  // ─── 事件通知 ───

  private async emitReport(report: SecurityReport): Promise<void> {
    const event: SecurityReportEvent = {
      type: 'report_generated',
      report,
      message: report.summary,
      timestamp: Date.now(),
    };

    for (const cb of this.callbacks) {
      try {
        await cb(event);
      } catch (err: any) {
        console.error('[SecurityReporter] 报告回调失败:', err.message);
      }
    }
  }

  // ─── 持久化 ───

  private loadConfig(): Partial<SecurityReporterConfig> {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (err: any) {
      console.error('[SecurityReporter] 加载配置失败:', err.message);
    }
    return {};
  }

  private saveConfig(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    fs.chmodSync(this.configPath, 0o600);
  }

  private loadLastReport(): void {
    try {
      if (fs.existsSync(this.reportPath)) {
        this.lastReport = JSON.parse(fs.readFileSync(this.reportPath, 'utf8'));
      }
    } catch (err: any) {
      console.error('[SecurityReporter] 加载上次报告失败:', err.message);
      this.lastReport = null;
    }
  }

  private saveLastReport(): void {
    const dir = path.dirname(this.reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.reportPath, JSON.stringify(this.lastReport, null, 2), 'utf8');
    fs.chmodSync(this.reportPath, 0o600);
  }
}
